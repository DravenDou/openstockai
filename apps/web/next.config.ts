import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: false,
  distDir: process.env.NEXT_DIST_DIR || ".next",
  output: "standalone",
  // Workspace packages ship TypeScript source (no build step).
  transpilePackages: ["@openstockai/api-client", "@openstockai/server"],
  // Nothing in the app is meant to be framed: the consent and approval pages decide on a click.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
    ];
  },
  // Trace from the monorepo root so standalone output includes workspace packages.
  outputFileTracingRoot: fileURLToPath(new URL("../..", import.meta.url)),
};
export default nextConfig;
