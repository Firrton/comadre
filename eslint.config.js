// @ts-check
import tseslint from "typescript-eslint";

export default tseslint.config(
  // --- Global ignores ---
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.turbo/**",
      // Vendored Solidity tooling
      "packages/monad-contracts/**",
      // Legacy / not in scope
      "experimental/**",
      // Uses its own `next lint` pipeline
      "apps/web/**",
      // Not in pnpm workspace (mobile)
      "apps/mobile/**",
      // Anchor / Solana packages (not in workspace, excluded)
      "packages/anchor-program/**",
      "packages/anchor-client/**",
      "packages/solana/**",
      // Generated Drizzle migration files
      "**/drizzle/**",
    ],
  },

  // --- TypeScript base (NON-type-aware) ---
  ...tseslint.configs.recommended,

  // --- Pragmatic rule overrides for this codebase ---
  {
    rules: {
      // Allow _-prefixed identifiers to signal intentionally unused params/vars
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
      // Codebase uses `any` in spots — warn, not error
      "@typescript-eslint/no-explicit-any": "warn",
      // Allow empty interfaces (used for branded types / extension points)
      "@typescript-eslint/no-empty-object-type": "warn",
      // Allow `require()` in config/migration scripts
      "@typescript-eslint/no-require-imports": "warn",
    },
  },
);
