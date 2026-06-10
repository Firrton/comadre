/**
 * /api/v1/wallet — read-only wallet information.
 *
 * NOTE: Solana RPC balance lookup was removed in the Monad migration.
 * TODO(monad-wallet): implement USDC balance via Monad RPC + ERC-20 balanceOf.
 */
import { Hono } from "hono";

export const walletRouter = new Hono();

/**
 * Read the user's USDC balance in micro-USDC units.
 *
 * In test/dev, the `X-Mock-USDC-Balance` header overrides the value.
 * In production, returns 0n until Monad RPC integration is wired up.
 * TODO(monad-wallet): call ERC-20 balanceOf via viem publicClient.
 */
export async function readUserUsdcBalanceMicro(c: {
  req: { header: (name: string) => string | undefined };
}, _walletAddress: string): Promise<bigint> {
  const mockHeader = c.req.header("X-Mock-USDC-Balance");
  if (process.env["NODE_ENV"] !== "production" && mockHeader) {
    return BigInt(mockHeader);
  }
  // TODO(monad-wallet): implement real Monad ERC-20 balanceOf lookup.
  return 0n;
}

walletRouter.get("/balance", async (c) => {
  // TODO(monad-wallet): implement Monad USDC balance via ERC-20 balanceOf.
  return c.json(
    {
      error: "not_implemented",
      message: "Wallet balance via Monad is pending migration. Coming soon.",
    },
    501,
  );
});
