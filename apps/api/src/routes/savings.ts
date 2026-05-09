/**
 * /api/v1/savings — Guardadito.
 *
 * User-facing product language is "Guardadito"; technical providers remain
 * internal strategy adapters (`mock` by default, `kamino` behind env).
 */
import { Hono } from "hono";
import type { Context } from "hono";
import { zValidator } from "@hono/zod-validator";
import { eq } from "drizzle-orm";
import { VersionedTransaction } from "@solana/web3.js";
import { env } from "@comadre/config";
import { db, savingsActions, savingsPositions, users } from "@comadre/db";
import { getRedis } from "@comadre/cache";
import { buildUnsignedTx, getConnection, getFeePayerKeypair, submitWithRetry } from "@comadre/solana";
import { GuardaditoActionAmountInput } from "@comadre/types";
import { getSavingsAdapter } from "../lib/savings/index.js";
import {
  calculateGuardaditoSuggestion,
  formatMicroUsdc,
} from "../lib/savings/amounts.js";
import { usdcToMicro } from "../lib/usdcTransfer.js";
import { enforceKycLimit, KycLimitExceededError, type KycTier } from "../lib/kycLimits.js";
import { signWithPrivy } from "../lib/privySigner.js";
import type { AuthUser } from "../middlewares/auth.js";
import { readUserUsdcBalanceMicro } from "./wallet.js";

export const savingsRouter = new Hono();

const SAVINGS_ACTION_TTL_SECONDS = 5 * 60;
const SAVINGS_TX_KEY_PREFIX = "savings:tx:";

function explorerUrlFor(signature: string): string {
  const suffix = env.SOLANA_CLUSTER === "mainnet-beta" ? "" : `?cluster=${env.SOLANA_CLUSTER}`;
  return `https://explorer.solana.com/tx/${signature}${suffix}`;
}

function extractPrivyWalletId(user: AuthUser): string | null {
  const accounts = user.linkedAccounts as Array<{
    type?: string;
    chainType?: string;
    id?: string;
  }>;
  const solanaWallet = accounts.find(
    (a) => a.type === "wallet" && (a.chainType === "solana" || a.chainType === undefined),
  );
  return solanaWallet?.id ?? null;
}

async function getAuthedUserRow(walletAddress: string) {
  const rows = await db.select().from(users).where(eq(users.wallet, walletAddress)).limit(1);
  return rows[0] ?? null;
}

async function buildSummary(c: Context, user: AuthUser) {
  const adapter = getSavingsAdapter();
  const [availableMicroUsdc, strategySummary] = await Promise.all([
    readUserUsdcBalanceMicro(c, user.walletAddress),
    adapter.getSummary(user.walletAddress),
  ]);
  const suggestion = calculateGuardaditoSuggestion({
    availableMicroUsdc,
    savedMicroUsdc: strategySummary.savedMicroUsdc,
  });

  return {
    provider: strategySummary.provider,
    strategyId: strategySummary.strategyId,
    available: formatMicroUsdc(availableMicroUsdc),
    saved: formatMicroUsdc(strategySummary.savedMicroUsdc),
    suggested: {
      shouldSuggest: suggestion.shouldSuggest,
      ...formatMicroUsdc(suggestion.suggestedMicroUsdc),
      liquidReserveUsdc: formatMicroUsdc(suggestion.liquidReserveMicroUsdc).usdc,
      reason: suggestion.reason,
    },
    copy: {
      short: suggestion.shouldSuggest
        ? `Mija, veo ${formatMicroUsdc(availableMicroUsdc).usdc} USDC quietitos. Podés guardar ${formatMicroUsdc(suggestion.suggestedMicroUsdc).usdc} y dejar ${formatMicroUsdc(suggestion.liquidReserveMicroUsdc).usdc} listos para tus gastos.`
        : "Tu platita está bien por ahora. Cuando haya más margen, te puedo sugerir un Guardadito.",
      risk: "No es promesa fija: el Guardadito puede variar y siempre te pido confirmación antes de mover dinero.",
    },
  };
}

savingsRouter.get("/summary", async (c) => {
  const user = (c.get as (k: string) => unknown)("user") as AuthUser;
  return c.json(await buildSummary(c, user));
});

async function prepareAction(
  c: Context,
  type: "deposit" | "withdraw",
) {
  const input = (c.req as unknown as { valid: (target: "json") => { amountUsdc: string } }).valid("json");
  const user = (c.get as (k: string) => unknown)("user") as AuthUser;
  const amountMicroUsdc = usdcToMicro(input.amountUsdc);
  const adapter = getSavingsAdapter();
  const userRow = await getAuthedUserRow(user.walletAddress);
  if (!userRow) {
    return c.json({ error: "USER_NOT_FOUND", message: "Tu cuenta no está registrada todavía." }, 404);
  }

  if (type === "deposit") {
    const available = await readUserUsdcBalanceMicro(c, user.walletAddress);
    if (amountMicroUsdc > available) {
      return c.json(
        {
          error: "INSUFFICIENT_BALANCE",
          message: "No hay suficiente USDC disponible para guardar ese monto.",
          available: formatMicroUsdc(available),
        },
        400,
      );
    }

    try {
      await enforceKycLimit(userRow.kycTier as KycTier, amountMicroUsdc);
    } catch (err) {
      if (err instanceof KycLimitExceededError) {
        return c.json(
          {
            error: err.code,
            message: `Tu nivel KYC (${err.tier}) permite hasta $${err.limitUsdc} USDC por movimiento.`,
            tier: err.tier,
            limitUsdc: err.limitUsdc,
          },
          400,
        );
      }
      throw err;
    }
  } else {
    const summary = await adapter.getSummary(user.walletAddress);
    if (amountMicroUsdc > summary.savedMicroUsdc) {
      return c.json(
        {
          error: "INSUFFICIENT_SAVINGS",
          message: "No hay suficiente en tu Guardadito para retirar ese monto.",
          saved: formatMicroUsdc(summary.savedMicroUsdc),
        },
        400,
      );
    }
  }

  const built = type === "deposit"
    ? await adapter.buildDeposit({ wallet: user.walletAddress, amountMicroUsdc })
    : await adapter.buildWithdraw({ wallet: user.walletAddress, amountMicroUsdc });

  let unsignedTxBase64 = built.unsignedTxBase64;
  if (!unsignedTxBase64 && built.instructions.length > 0) {
    const tx = await buildUnsignedTx({
      instructions: built.instructions,
      payer: getFeePayerKeypair(),
      connection: getConnection(),
    });
    unsignedTxBase64 = tx.unsignedTxBase64;
  }

  const expiresAt = new Date(Date.now() + SAVINGS_ACTION_TTL_SECONDS * 1000);
  const inserted = await db
    .insert(savingsActions)
    .values({
      userWallet: user.walletAddress,
      provider: built.provider,
      strategyId: built.strategyId,
      type,
      amountMicroUsdc,
      status: "pending",
      expiresAt,
    })
    .returning();
  const action = inserted[0];
  if (!action) throw new Error("Insert returned no savings action");

  if (unsignedTxBase64) {
    const key = `${SAVINGS_TX_KEY_PREFIX}${action.id}`;
    await getRedis().set(key, unsignedTxBase64, { ex: SAVINGS_ACTION_TTL_SECONDS }).catch(() => undefined);
    await db.update(savingsActions).set({ unsignedTxKey: key }).where(eq(savingsActions.id, action.id));
  }

  return c.json({
    actionId: action.id,
    type,
    provider: built.provider,
    strategyId: built.strategyId,
    amount: formatMicroUsdc(amountMicroUsdc),
    status: "pending" as const,
    expiresAt: expiresAt.toISOString(),
    ...(unsignedTxBase64 ? { unsignedTxBase64 } : {}),
    summary:
      type === "deposit"
        ? `Guardadito preparado: ${formatMicroUsdc(amountMicroUsdc).usdc} USDC. Confirmá antes de guardar.`
        : `Retiro preparado: ${formatMicroUsdc(amountMicroUsdc).usdc} USDC. Confirmá antes de sacar.`,
  });
}

savingsRouter.post(
  "/deposits",
  zValidator("json", GuardaditoActionAmountInput, (result, c) => {
    if (!result.success) return c.json({ error: "validation", issues: result.error.format() }, 400);
  }),
  (c) => prepareAction(c, "deposit"),
);

savingsRouter.post(
  "/withdrawals",
  zValidator("json", GuardaditoActionAmountInput, (result, c) => {
    if (!result.success) return c.json({ error: "validation", issues: result.error.format() }, 400);
  }),
  (c) => prepareAction(c, "withdraw"),
);

savingsRouter.post("/actions/:id/confirm", async (c) => {
  const actionId = c.req.param("id");
  const user = (c.get as (k: string) => unknown)("user") as AuthUser;
  const rows = await db.select().from(savingsActions).where(eq(savingsActions.id, actionId)).limit(1);
  const action = rows[0];
  if (!action) return c.json({ error: "NOT_FOUND" }, 404);
  if (action.userWallet !== user.walletAddress) return c.json({ error: "FORBIDDEN" }, 403);
  if (action.status !== "pending") return c.json({ error: "INVALID_STATUS", status: action.status }, 409);
  if (action.expiresAt.getTime() < Date.now()) {
    await db.update(savingsActions).set({ status: "expired" }).where(eq(savingsActions.id, action.id));
    return c.json({ error: "EXPIRED" }, 409);
  }

  if (action.provider === "mock") {
    const current = await getSavingsAdapter().getSummary(user.walletAddress);
    const nextSaved = action.type === "deposit"
      ? current.savedMicroUsdc + action.amountMicroUsdc
      : current.savedMicroUsdc - action.amountMicroUsdc;

    await db
      .insert(savingsPositions)
      .values({
        userWallet: user.walletAddress,
        provider: "mock",
        strategyId: action.strategyId,
        depositedMicroUsdc: nextSaved,
        shareAmount: nextSaved.toString(),
        lastKnownUnderlyingMicroUsdc: nextSaved,
        status: "active",
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [savingsPositions.userWallet, savingsPositions.provider, savingsPositions.strategyId],
        set: {
          depositedMicroUsdc: nextSaved,
          shareAmount: nextSaved.toString(),
          lastKnownUnderlyingMicroUsdc: nextSaved,
          updatedAt: new Date(),
        },
      });

    await db
      .update(savingsActions)
      .set({ status: "confirmed", confirmedAt: new Date(), txSignature: "mock" })
      .where(eq(savingsActions.id, action.id));

    return c.json({ actionId: action.id, status: "confirmed" as const });
  }

  if (!action.unsignedTxKey) {
    return c.json({ error: "MISSING_TX", message: "No transaction found for this action." }, 409);
  }

  const unsignedTxBase64 = await getRedis().get<string>(action.unsignedTxKey).catch(() => null);
  if (!unsignedTxBase64) return c.json({ error: "EXPIRED" }, 409);

  const walletId = extractPrivyWalletId(user);
  if (!walletId) return c.json({ error: "NO_WALLET" }, 400);

  const tx = VersionedTransaction.deserialize(Buffer.from(unsignedTxBase64, "base64"));
  const signed = await signWithPrivy({ walletId, transaction: tx });
  const result = await submitWithRetry(signed.signedTransaction);

  await db
    .update(savingsActions)
    .set({ status: "confirmed", confirmedAt: new Date(), txSignature: result.signature })
    .where(eq(savingsActions.id, action.id));

  return c.json({
    actionId: action.id,
    status: "confirmed" as const,
    signature: result.signature,
    explorerUrl: explorerUrlFor(result.signature),
  });
});

savingsRouter.post("/actions/:id/cancel", async (c) => {
  const actionId = c.req.param("id");
  const user = (c.get as (k: string) => unknown)("user") as AuthUser;
  const rows = await db.select().from(savingsActions).where(eq(savingsActions.id, actionId)).limit(1);
  const action = rows[0];
  if (!action) return c.json({ error: "NOT_FOUND" }, 404);
  if (action.userWallet !== user.walletAddress) return c.json({ error: "FORBIDDEN" }, 403);
  if (action.status !== "pending") return c.json({ error: "INVALID_STATUS", status: action.status }, 409);

  await db.update(savingsActions).set({ status: "cancelled" }).where(eq(savingsActions.id, action.id));
  if (action.unsignedTxKey) await getRedis().del(action.unsignedTxKey).catch(() => undefined);
  return c.json({ actionId: action.id, status: "cancelled" as const });
});
