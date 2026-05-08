import type { NextConfig } from "next";

const config: NextConfig = {
  experimental: {
    typedRoutes: true,
  },
  transpilePackages: ["@comadre/types"],
};

export default config;
