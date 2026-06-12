import type { Config } from "tailwindcss";

// Brand tokens from docs/BRANDING.md — "Tía Vera" palette
const config: Config = {
  content: ["./app/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        hoja: "#1f2e1c",
        nopal: "#7c8c4f",
        olivo: "#43542a",
        barro: "#a86b3c",
        miel: "#d49a4a",
        papel: "#eee8d2",
      },
      fontFamily: {
        display: ["var(--font-newsreader)", "serif"],
        headline: ["var(--font-petrona)", "serif"],
        sans: ["var(--font-outfit)", "sans-serif"],
        hand: ["var(--font-caveat)", "cursive"],
      },
    },
  },
  plugins: [],
};

export default config;
