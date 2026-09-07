import nextConfig from "eslint-config-next";

const config = [
  ...nextConfig,
  { ignores: [".next/", "node_modules/", ".tmp/", "out/"] },
];

export default config;
