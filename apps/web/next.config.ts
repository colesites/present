import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  reactCompiler: true,
  // The desktop's access tokens are signed here, and Convex finds the key by
  // asking this site's well-known addresses (`lib/server/desktop-jwt.ts`).
  // Rewrites rather than routes, because Next does not serve a `.well-known`
  // directory from `app/`.
  async rewrites() {
    return [
      {
        source: "/.well-known/openid-configuration",
        destination: "/api/oidc/openid-configuration",
      },
      { source: "/.well-known/jwks.json", destination: "/api/oidc/jwks" },
    ];
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "**",
      },
      {
        protocol: "http",
        hostname: "**",
      },
      {
        protocol: "https",
        hostname: "images.unsplash.com",
      },
    ],
  },
};

export default nextConfig;
