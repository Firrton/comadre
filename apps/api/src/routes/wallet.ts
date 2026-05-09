/**
 * /api/v1/wallet — read-only wallet information used by Comadre.
 */
import { Hono } from "hono";
import { PublicKey } from "@solana/web3.js";
import { getUsdcMint } from "@comadre/anchor-client";
import { getUsdcBalanceMicro } from "@comadre/solana";
import type { AuthUser } from "../middlewares/auth.js";
import { formatMicroUsdc } from "../lib/savings/amounts.js";

export const walletRouter = new Hono();

export async function readUserUsdcBalanceMicro(c: {
  req: { header: (name: string) => string | undefined };
}, walletAddress: string): Promise<bigint> {
  const mockHeader = c.req.header("X-Mock-USDC-Balance");
  if (process.env["NODE_ENV"] !== "production" && mockHeader) {
    return BigInt(mockHeader);
  }

  return getUsdcBalanceMicro({
    owner: new PublicKey(walletAddress),
    mint: getUsdcMint(),
  });
}

walletRouter.get("/balance", async (c) => {
  const user = (c.get as (k: string) => unknown)("user") as AuthUser;
  const microUsdc = await readUserUsdcBalanceMicro(c, user.walletAddress);

  return c.json({
    wallet: user.walletAddress,
    ...formatMicroUsdc(microUsdc),
  });
});
