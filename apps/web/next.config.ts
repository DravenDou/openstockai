import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: false,
  distDir: process.env.NEXT_DIST_DIR || ".next",
  output: "standalone",
  // Workspace packages ship TypeScript source (no build step).
  transpilePackages: ["@openstockai/api-client", "@openstockai/server"],
  // Trace from the monorepo root so standalone output includes workspace packages.
  outputFileTracingRoot: fileURLToPath(new URL("../..", import.meta.url)),
};
export default nextConfig;
