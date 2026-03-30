# Electron Image Loading - Debugging Guide

## Problem Overview

Images from Convex storage work correctly on the web but fail to display in Electron. This is a common issue when integrating cloud storage with Electron applications.

## Root Causes

### 1. Content Security Policy (CSP)
Electron enforces stricter CSP rules than browsers. External image sources must be explicitly allowed in the `img-src` directive.

### 2. Storage ID vs URL
Convex returns `storageId` values that need to be converted to actual URLs using `ctx.storage.getUrl()` in backend queries.

### 3. Cross-Origin Resource Sharing (CORS)
Electron's security model may block cross-origin image requests without proper configuration.

## Solution Implementation

### Backend: Convert Storage IDs to URLs

In your Convex queries, always convert storage IDs to URLs:

```typescript
// ❌ WRONG - Returns storage ID
return {
  logo: organization.logo
};

// ✅ CORRECT - Returns actual URL
let logoUrl: string | null = null;
if (organization.logo) {
  // Check if it's already a URL (data: or https:)
  if (organization.logo.startsWith('http') || organization.logo.startsWith('data:')) {
    logoUrl = organization.logo;
  } else {
    // It's a storageId, convert it
    logoUrl = await ctx.storage.getUrl(organization.logo);
  }
}

return {
  logo: logoUrl
};
```

### Frontend: Handle Both Data URLs and Regular URLs

```tsx
{logo ? (
  logo.startsWith("data:") ? (
    // Data URLs can be used directly
    <img
      src={logo}
      alt="Organization"
      className="h-10 w-10 rounded-full object-cover"
    />
  ) : (
    // Regular URLs need crossOrigin for Convex
    <img
      src={logo}
      alt="Organization"
      className="h-10 w-10 rounded-full object-cover"
      crossOrigin="anonymous"
    />
  )
) : (
  <span>Fallback</span>
)}
```

### Electron: Configure CSP to Allow Convex Domains

In your `BrowserWindow` configuration:

```typescript
mainWindow.webContents.session.webRequest.onHeadersReceived((details, callback) => {
  callback({
    responseHeaders: {
      ...details.responseHeaders,
      'Content-Security-Policy': [
        "default-src 'self' 'unsafe-inline' data: local-media: app:; " +
        "img-src 'self' data: local-media: https://*.convex.cloud https://*.convex.site https://*.gravatar.com https://*.wp.com https://lh3.googleusercontent.com https://*.googleusercontent.com https://img.clerk.com; " +
        // ... other directives
      ]
    }
  });
});
```

Key points:
- `data:` - Allows base64 data URLs
- `https://*.convex.cloud` - Allows Convex storage URLs
- `https://*.convex.site` - Allows Convex deployment URLs

## Debugging Steps

### 1. Open Electron DevTools

In development mode, DevTools should open automatically. If not:

```typescript
if (isDev()) {
  mainWindow.webContents.openDevTools();
}
```

### 2. Check Network Tab

- Look for image requests
- Check status codes:
  - `200` = Success
  - `403` = Forbidden (CSP or CORS issue)
  - `401` = Unauthorized (authentication issue)
  - `ERR_BLOCKED_BY_CLIENT` = CSP blocking

### 3. Check Console for CSP Errors

Look for messages like:
```
Refused to load the image 'https://...' because it violates the following Content Security Policy directive: "img-src 'self'"
```

### 4. Verify URL Format

In the console, check what URLs are being used:

```javascript
console.log('Logo URL:', logo);
// Should be: https://wary-badger-863.convex.cloud/api/storage/...
// NOT: kg2... (storage ID)
```

### 5. Test CORS Headers

In DevTools Network tab, check response headers for:
```
Access-Control-Allow-Origin: *
```

## Common Issues and Fixes

### Issue: Images show placeholder/broken
**Cause**: Backend returning storage ID instead of URL  
**Fix**: Use `ctx.storage.getUrl()` in backend queries

### Issue: CSP violation errors in console
**Cause**: Convex domains not allowed in CSP  
**Fix**: Add `https://*.convex.cloud` and `https://*.convex.site` to `img-src`

### Issue: CORS errors
**Cause**: Missing `crossOrigin="anonymous"` attribute  
**Fix**: Add `crossOrigin="anonymous"` to `<img>` tags for external URLs

### Issue: Data URLs not working
**Cause**: `data:` not allowed in CSP  
**Fix**: Add `data:` to `img-src` directive

## Testing Checklist

- [ ] Backend converts storage IDs to URLs
- [ ] Frontend handles both data URLs and regular URLs
- [ ] CSP includes `data:`, `https://*.convex.cloud`, `https://*.convex.site`
- [ ] `crossOrigin="anonymous"` added to external image tags
- [ ] DevTools shows no CSP violations
- [ ] Network tab shows 200 status for image requests
- [ ] Images display correctly in both web and desktop apps

## Additional Resources

- [Electron Security](https://www.electronjs.org/docs/latest/tutorial/security)
- [Content Security Policy](https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP)
- [Convex Storage](https://docs.convex.dev/file-storage)
