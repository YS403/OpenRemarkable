import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  // Fonts are read from disk when exporting edits; serverless bundles only
  // include files they import unless told otherwise.
  outputFileTracingIncludes: {
    "/api/projects/*/export": ["./public/fonts/inter/**/*"],
  },
  partialPrefetching: true,
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
