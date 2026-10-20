import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Cloud Run image (stage 3). Env files must never reach the image: see .dockerignore.
  output: "standalone",
  cacheComponents: true,
  partialPrefetching: true,
  poweredByHeader: false,
  // gRPC + protobuf files are loaded at runtime; keep the SDK out of the server bundle.
  serverExternalPackages: ["@google-cloud/firestore"],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
