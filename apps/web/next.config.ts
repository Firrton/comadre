import type { NextConfig } from "next";

const config: NextConfig = {
  experimental: {
    typedRoutes: true,
  },
  transpilePackages: ["@comadre/types", "@comadre/wallet-infra"],
  webpack: (config) => {
    // Workspace packages use ESM ".js" specifiers over TypeScript sources
    // (resolved natively by Bun); webpack needs the alias to find the .ts files.
    config.resolve.extensionAlias = {
      ".js": [".ts", ".tsx", ".js"],
    };
    return config;
  },
};

export default config;
