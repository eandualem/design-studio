import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The design controller's instructions are a Markdown file in profiles/,
  // imported as a string.
  turbopack: {
    rules: { "*.md": { loaders: ["raw-loader"], as: "*.js" } },
  },
};

export default nextConfig;
