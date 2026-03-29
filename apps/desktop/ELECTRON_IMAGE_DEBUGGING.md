# Electron Image Loading - Complete Solution & Debugging Guide

## ✅ Solution Implemented

### 1. Backend Changes
- **File**: `packages/backend/convex/users.ts`
- **Changes**:
  - `listMyOrganizations` now converts Convex storage IDs to URLs
  - `getCurrentUser` now includes organization logos
  - Handles both data URLs and Convex storage IDs

### 2. Desktop App Changes
- **File**: `apps/desktop/src/renderer/shared/store/desktopSession.ts`
  - Added `logo?: string` to `DesktopOrganization` interface

- **File**: `apps/desktop/src/renderer/main/App.tsx`
  - Updated type definitions to include `logo` field
  - Passes logo data through to session store

- **File**: `apps/desktop/src/renderer/shared/components/AuthControls.tsx`
  - Displays organization logo in header button
  - Displays logos in dropdown list
  - Uses `<img>` tag with `crossOrigin="anonymous"` for Convex URLs
  - Uses regular `<img>` for data URLs

- **File**: `apps/desktop/src/main/windows/main.window.ts`
  - CSP allows images from `*.convex.cloud` and `*.convex.site`
  - CSP allows `data:` URLs for base64 images

## 🔍 Debugging Steps

### 1. Open Electron DevTools
The app should already open DevTools in development mode. If not, add this to your main window:

```typescript
if (isDev()) {
  mainWindow.webContents.openDevTools();
}
```

### 2. Check Console for Errors
Look for:
- `Refused to load image because it violates CSP img-src directive`
- `Failed to load resource: net::ERR_BLOCKED_BY_CLIENT`
- `CORS policy` errors

### 3. Check Network Tab
1. Open DevTools → Network tab
2. Filter by "Img"
3. Look for failed requests (red)
4. Click on failed request to see:
   - Status code (403, 401, 0)
   - Response headers
   - Error message

### 4. Test Image URL in Console
```javascript
// Check what the organization logo URL is
const orgs = JSON.parse(localStorage.getItem('present-desktop-session'));
console.log('Organizations:', orgs?.state?.organizations);

// Test loading an image
const testImg = new Image();
testImg.onload = () => console.log('✅ Image loaded successfully!');
testImg.onerror = (e) => console.error('❌ Image failed to load:', e);
testImg.crossOrigin = 'anonymous';
testImg.src = 'YOUR_CONVEX_URL_HERE';
```

### 5. Check CSP Headers
```javascript
// In DevTools Console
console.log(document.querySelector('meta[http-equiv="Content-Security-Policy"]'));
```

### 6. Verify Convex URL Format
Convex URLs should look like:
```
https://wary-badger-863.convex.cloud/api/storage/...
```

NOT like:
```
kg2h8j9k2h3j4k5h6j7k8l9m0n1p2q3r  // This is a storage ID, not a URL
```

## 🐛 Common Issues & Solutions

### Issue 1: Images Show on Web but Not Desktop
**Cause**: CSP blocking external images
**Solution**: ✅ Already fixed - CSP now allows `*.convex.cloud`

### Issue 2: "Invalid storage ID" Error
**Cause**: Trying to use `ctx.storage.getUrl()` on a data URL
**Solution**: ✅ Already fixed - Backend checks if it's already a URL

### Issue 3: CORS Errors
**Cause**: Convex URLs require CORS headers
**Solution**: Use `crossOrigin="anonymous"` on `<img>` tags (✅ implemented)

### Issue 4: Images Work Once Then Fail
**Cause**: Convex signed URLs expire after ~1 hour
**Solution**: Re-query data periodically or implement caching (see below)

## 🚀 Advanced: Local Image Caching (Optional)

If you need offline support or want to avoid URL expiration:

### 1. Create IPC Handler for Image Download
```typescript
// apps/desktop/src/main/ipc/image.ipc.ts
import { ipcMain, app } from 'electron';
import fs from 'fs';
import path from 'path';
import https from 'https';
import crypto from 'crypto';

export const setupImageIPC = (): void => {
  ipcMain.handle('download-image', async (_event, url: string) => {
    const hash = crypto.createHash('md5').update(url).digest('hex');
    const ext = path.extname(new URL(url).pathname) || '.jpg';
    const filename = `${hash}${ext}`;
    const filePath = path.join(app.getPath('userData'), 'images', filename);

    // Create images directory if it doesn't exist
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Return cached file if it exists
    if (fs.existsSync(filePath)) {
      return `file://${filePath}`;
    }

    // Download the image
    return new Promise((resolve, reject) => {
      const file = fs.createWriteStream(filePath);
      https.get(url, (response) => {
        response.pipe(file);
        file.on('finish', () => {
          file.close();
          resolve(`file://${filePath}`);
        });
      }).on('error', (err) => {
        fs.unlink(filePath, () => {});
        reject(err);
      });
    });
  });
};
```

### 2. Add to Preload Script
```typescript
// apps/desktop/src/main/preload.ts
contextBridge.exposeInMainWorld('electronAPI', {
  // ... existing methods
  downloadImage: (url: string) => ipcRenderer.invoke('download-image', url),
});
```

### 3. Use in React Component
```typescript
const [localImageUrl, setLocalImageUrl] = useState<string | null>(null);

useEffect(() => {
  if (organization.logo && organization.logo.startsWith('https://')) {
    window.electronAPI.downloadImage(organization.logo)
      .then(setLocalImageUrl)
      .catch(console.error);
  } else {
    setLocalImageUrl(organization.logo);
  }
}, [organization.logo]);

return <img src={localImageUrl || organization.logo} alt={organization.name} />;
```

## 📊 Current Configuration

### CSP Policy (apps/desktop/src/main/windows/main.window.ts)
```
img-src 'self' data: local-media: 
  https://*.convex.cloud 
  https://*.convex.site 
  https://*.gravatar.com 
  https://*.wp.com 
  https://lh3.googleusercontent.com 
  https://*.googleusercontent.com 
  https://img.clerk.com
```

### Web Security Settings
```typescript
webPreferences: {
  webSecurity: true,  // ✅ Enabled for security
  contextIsolation: true,  // ✅ Enabled for security
  nodeIntegration: false,  // ✅ Disabled for security
}
```

## ✅ Checklist

- [x] Backend converts storage IDs to URLs
- [x] Backend handles data URLs correctly
- [x] Desktop session store includes logo field
- [x] AuthControls displays organization logos
- [x] CSP allows Convex cloud domains
- [x] CSP allows data URLs
- [x] Images use crossOrigin for CORS
- [ ] (Optional) Implement local caching for offline support

## 🎯 Expected Behavior

1. **On Web**: Images load directly from Convex or data URLs
2. **On Desktop**: Images load from Convex with CORS headers or from data URLs
3. **Fallback**: If no logo, show organization initials

## 📝 Notes

- Convex signed URLs expire after ~1 hour
- Re-querying data will get fresh URLs
- Data URLs (base64) never expire but are larger
- Local caching is recommended for production apps
