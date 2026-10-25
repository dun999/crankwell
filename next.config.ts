import type { NextConfig } from "next";

const noindex = [{ key: "X-Robots-Tag", value: "noindex, nofollow, noarchive, nosnippet, noimageindex" }];

const nextConfig: NextConfig = {
  serverExternalPackages: ["better-sqlite3"],
  // OAuth discovery for the MCP connector lives under /api/oauth.
  async rewrites() {
    return [
      { source: "/.well-known/oauth-protected-resource", destination: "/api/oauth/protected-resource" },
      { source: "/.well-known/oauth-protected-resource/:path*", destination: "/api/oauth/protected-resource" },
      { source: "/.well-known/oauth-authorization-server", destination: "/api/oauth/authorization-server" },
      { source: "/.well-known/oauth-authorization-server/:path*", destination: "/api/oauth/authorization-server" },
    ];
  },
  // The app moved to /app; diagnosis links from Claude made before that still land on it.
  async redirects() {
    return [
      { source: "/", has: [{ type: "query", key: "case" }], destination: "/app", permanent: false },
      { source: "/", has: [{ type: "query", key: "paypal" }], destination: "/app", permanent: false },
    ];
  },
  async headers() {
    return [
      { source: "/", headers: noindex },
      { source: "/:path*", headers: noindex },
    ];
  },
};

export default nextConfig;
