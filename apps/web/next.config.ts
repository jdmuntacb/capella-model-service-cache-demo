import type { NextConfig } from "next";
import { resolve } from "node:path";

// Share the repo-root .env with the bench CLI and mock gateway.
try {
  process.loadEnvFile(resolve(process.cwd(), "../../.env"));
} catch {
  // No .env: defaults to the mock gateway.
}

const nextConfig: NextConfig = {
  transpilePackages: ["@demo/core"],
  devIndicators: false,
  turbopack: { root: resolve(process.cwd(), "../..") },
};

export default nextConfig;
