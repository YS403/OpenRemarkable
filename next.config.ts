import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  // Fonts are read from disk when exporting edits; serverless bundles only
  // include files they import unless told otherwise.
  outputFileTracingIncludes: {
    "/api/projects/*/export": ["./public/fonts/inter/**/*"],
  },
  partialPrefetching: true,
  // ssh2 (App Store installs over USB) optionally loads native add-ons; load it with Node's require
  serverExternalPackages: ["ssh2"],
  // the Planner page used to be called Calendar; keep old links and bookmarks working
  async redirects() {
    return [{ source: "/calendar", destination: "/planner", permanent: true }];
  },
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
