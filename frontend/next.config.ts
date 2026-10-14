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
    return sources.map((source) => ({ source, headers: noStore }));
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
