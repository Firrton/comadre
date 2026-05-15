import { defineChain } from "viem";

/**
 * Monad Testnet (chain ID 10143).
 *
 * Some viem versions don't ship a built-in `monadTestnet` chain yet,
 * so we define it explicitly here. Re-exported from the package root.
 */
export const monadTestnet = defineChain({
  id: 10143,
  name: "Monad Testnet",
  nativeCurrency: { name: "Monad", symbol: "MON", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://testnet-rpc.monad.xyz"] },
  },
  blockExplorers: {
    default: {
      name: "MonadExplorer",
      url: "https://testnet.monadexplorer.com",
    },
  },
  testnet: true,
});

export const monadMainnet = defineChain({
  id: 143,
  name: "Monad",
  nativeCurrency: { name: "Monad", symbol: "MON", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://rpc.monad.xyz"] },
  },
  blockExplorers: {
    default: { name: "MonadScan", url: "https://monadscan.com" },
  },
});

export function getChainById(id: number) {
  if (id === monadTestnet.id) return monadTestnet;
  if (id === monadMainnet.id) return monadMainnet;
  throw new Error(`[wallet-infra/chains] unsupported chain id: ${id}`);
}
