import path from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const appRoot = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  output: "standalone",
  cacheComponents: true,
  partialPrefetching: true,
  async headers() {
    const noStore = [
      { key: "Cache-Control", value: "private, no-store" },
      { key: "Pragma", value: "no-cache" },
    ];
    const sources = [
      "/student",
      "/student/:path*",
      "/staff",
      "/staff/:path*",
      "/cashier",
      "/cashier/:path*",
      "/admin",
      "/admin/:path*",
      "/invite/:path*",
    ];
    const privateRoutes = sources.map((source) => ({ source, headers: noStore }));
    return [
      ...privateRoutes,
      {
        // The browser must always re-check the worker so a fix reaches phones quickly.
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
      {
        source: "/manifest.webmanifest",
        headers: [
          { key: "Cache-Control", value: "no-cache" },
          { key: "Content-Type", value: "application/manifest+json" },
        ],
      },
    ];
  },
  turbopack: {
    root: appRoot,
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
