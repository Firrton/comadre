/**
 * /api/v1/savings — Guardadito.
 *
 * User-facing product language is "Guardadito"; technical providers remain
 * internal strategy adapters (`mock` by default, `neverland` behind env).
 *
 * NOTE: non-mock providers that required Solana SPL signing (Privy + submitWithRetry)
 * now return 501 pending Monad migration.
 */
import { Hono } from "hono";
import type { Context } from "hono";
import type { Address } from "viem";
import { zValidator } from "@hono/zod-validator";
import { and, eq } from "drizzle-orm";
import { db, savingsActions, savingsPositions, users } from "@comadre/db";
import { getRedis } from "@comadre/cache";
import { GuardaditoActionAmountInput } from "@comadre/types";
import { getSavingsAdapter } from "../lib/savings/index.js";
import {
  depositToNeverland,
  withdrawFromNeverland,
  getPrincipalsFromDb,
  resolveNeverlandConfig,
  NEVERLAND_STRATEGY_ID,
} from "../lib/savings/neverlandSavingsAdapter.js";
import {
  calculateGuardaditoSuggestion,
  formatMicroUsdc,
} from "../lib/savings/amounts.js";
import { usdcToMicro } from "../lib/monadUsdcTransfer.js";
import { enforceKycLimit, KycLimitExceededError, type KycTier } from "../lib/kycLimits.js";
import type { AuthUser } from "../middlewares/auth.js";
import { readUserUsdcBalanceMicro } from "./wallet.js";

export const savingsRouter = new Hono();

const SAVINGS_ACTION_TTL_SECONDS = 5 * 60;
const SAVINGS_TX_KEY_PREFIX = "savings:tx:";

async function getAuthedUserRow(userId: string) {
  const rows = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  return rows[0] ?? null;
}

async function buildSummary(c: Context, user: AuthUser) {
  const adapter = getSavingsAdapter();
  const [availableMicroUsdc, strategySummary] = await Promise.all([
    readUserUsdcBalanceMicro(c, user.ownerAddress),
    adapter.getSummary(user.id),
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
    apy_percent: strategySummary.apyPercent,
    apy_disclaimer: "Variable y no garantizado. Cambia con el mercado.",
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
  const userRow = await getAuthedUserRow(user.id);
  if (!userRow) {
    return c.json({ error: "USER_NOT_FOUND", message: "Tu cuenta no está registrada todavía." }, 404);
  }

  if (type === "deposit") {
    const available = await readUserUsdcBalanceMicro(c, user.ownerAddress);
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
    const summary = await adapter.getSummary(user.id);
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
    ? await adapter.buildDeposit({ wallet: user.id, amountMicroUsdc })
    : await adapter.buildWithdraw({ wallet: user.id, amountMicroUsdc });

  // Non-mock providers that built Solana transactions are not supported post-migration.
  // Only the mock provider (unsignedTxBase64 absent) is functional; on-chain Monad
  // savings integration is pending.
  const unsignedTxBase64: string | undefined = built.unsignedTxBase64 ?? undefined;

  const expiresAt = new Date(Date.now() + SAVINGS_ACTION_TTL_SECONDS * 1000);
  const inserted = await db
    .insert(savingsActions)
    .values({
      userId: user.id,
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
  if (action.userId !== user.id) return c.json({ error: "FORBIDDEN" }, 403);
  if (action.status !== "pending") return c.json({ error: "INVALID_STATUS", status: action.status }, 409);
  if (action.expiresAt.getTime() < Date.now()) {
    await db.update(savingsActions).set({ status: "expired" }).where(eq(savingsActions.id, action.id));
    return c.json({ error: "EXPIRED" }, 409);
  }

  if (action.provider === "mock") {
    const current = await getSavingsAdapter().getSummary(user.id);
    const nextSaved = action.type === "deposit"
      ? current.savedMicroUsdc + action.amountMicroUsdc
      : current.savedMicroUsdc - action.amountMicroUsdc;

    await db
      .insert(savingsPositions)
      .values({
        userId: user.id,
        provider: "mock",
        strategyId: action.strategyId,
        depositedMicroUsdc: nextSaved,
        shareAmount: nextSaved.toString(),
        lastKnownUnderlyingMicroUsdc: nextSaved,
        status: "active",
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [savingsPositions.userId, savingsPositions.provider, savingsPositions.strategyId],
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

  if (action.provider === "neverland") {
    let cfg: ReturnType<typeof resolveNeverlandConfig>;
    try {
      cfg = resolveNeverlandConfig();
    } catch (err) {
      return c.json(
        {
          error: "CONFIG_MISSING",
          message: err instanceof Error ? err.message : "Neverland configuration is incomplete.",
        },
        503,
      );
    }

    const walletAddress = user.id as Address;

    if (action.type === "deposit") {
      let result: Awaited<ReturnType<typeof depositToNeverland>>;
      try {
        result = await depositToNeverland({
          smartWalletAddress: walletAddress,
          amountMicroUsdc: action.amountMicroUsdc,
        });
      } catch (err) {
        await db
          .update(savingsActions)
          .set({
            status: "failed",
            failureReason: err instanceof Error ? err.message : String(err),
          })
          .where(eq(savingsActions.id, action.id));
        return c.json(
          {
            error: "TX_FAILED",
            message: "On-chain deposit failed. Tu dinero no fue movido.",
          },
          502,
        );
      }

      // Atomically update position and mark action confirmed.
      // Read existing position to compute cumulative totals.
      const existingRows = await db
        .select({
          deposited: savingsPositions.depositedMicroUsdc,
          withdrawn: savingsPositions.principalWithdrawnMicroUsdc,
          shareAmount: savingsPositions.shareAmount,
        })
        .from(savingsPositions)
        .where(
          and(
            eq(savingsPositions.userId, user.id),
            eq(savingsPositions.provider, "neverland"),
            eq(savingsPositions.strategyId, NEVERLAND_STRATEGY_ID),
          ),
        )
        .limit(1);
      const existing = existingRows[0];
      const newDeposited = (existing?.deposited ?? 0n) + action.amountMicroUsdc;
      const existingShares = BigInt(existing?.shareAmount ?? "0");
      const newShares = existingShares + result.nUsdcReceived;

      await db
        .insert(savingsPositions)
        .values({
          userId: user.id,
          provider: "neverland",
          strategyId: NEVERLAND_STRATEGY_ID,
          depositedMicroUsdc: newDeposited,
          principalWithdrawnMicroUsdc: existing?.withdrawn ?? 0n,
          shareAmount: newShares.toString(),
          lastKnownUnderlyingMicroUsdc: newDeposited - (existing?.withdrawn ?? 0n),
          status: "active",
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [savingsPositions.userId, savingsPositions.provider, savingsPositions.strategyId],
          set: {
            depositedMicroUsdc: newDeposited,
            shareAmount: newShares.toString(),
            lastKnownUnderlyingMicroUsdc: newDeposited - (existing?.withdrawn ?? 0n),
            updatedAt: new Date(),
          },
        });

      await db
        .update(savingsActions)
        .set({ status: "confirmed", confirmedAt: new Date(), txSignature: result.txHash })
        .where(eq(savingsActions.id, action.id));

      return c.json({
        actionId: action.id,
        status: "confirmed" as const,
        txHash: result.txHash,
        nUsdcReceived: result.nUsdcReceived.toString(),
      });
    }

    // Withdrawal path
    const { deposited: preWithdrawDeposited, withdrawn: preWithdrawWithdrawn } =
      await getPrincipalsFromDb(user.id);
    let result: Awaited<ReturnType<typeof withdrawFromNeverland>>;
    try {
      result = await withdrawFromNeverland({
        smartWalletAddress: walletAddress,
        amountRequestedMicroUsdc: action.amountMicroUsdc,
        netPrincipalRemaining: preWithdrawDeposited - preWithdrawWithdrawn,
        feeBps: cfg.feeBps,
        comadreFeeWallet: cfg.comadreFeeWallet,
      });
    } catch (err) {
      await db
        .update(savingsActions)
        .set({
          status: "failed",
          failureReason: err instanceof Error ? err.message : String(err),
        })
        .where(eq(savingsActions.id, action.id));
      return c.json(
        {
          error: "TX_FAILED",
          message: "On-chain withdrawal failed. Tu dinero no fue movido.",
        },
        502,
      );
    }

    // Update position: derive the new principalWithdrawn total from deposited - newPositionPrincipal.
    const newPrincipalWithdrawn = preWithdrawDeposited - result.newPositionPrincipalMicroUsdc;

    await db
      .insert(savingsPositions)
      .values({
        userId: user.id,
        provider: "neverland",
        strategyId: NEVERLAND_STRATEGY_ID,
        depositedMicroUsdc: preWithdrawDeposited,
        principalWithdrawnMicroUsdc: newPrincipalWithdrawn,
        shareAmount: "0",
        lastKnownUnderlyingMicroUsdc: result.newPositionPrincipalMicroUsdc,
        status: newPrincipalWithdrawn >= preWithdrawDeposited ? "closed" : "active",
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [savingsPositions.userId, savingsPositions.provider, savingsPositions.strategyId],
        set: {
          principalWithdrawnMicroUsdc: newPrincipalWithdrawn,
          lastKnownUnderlyingMicroUsdc: result.newPositionPrincipalMicroUsdc,
          status: newPrincipalWithdrawn >= preWithdrawDeposited ? "closed" : "active",
          updatedAt: new Date(),
        },
      });

    await db
      .update(savingsActions)
      .set({ status: "confirmed", confirmedAt: new Date(), txSignature: result.txHash })
      .where(eq(savingsActions.id, action.id));

    return c.json({
      actionId: action.id,
      status: "confirmed" as const,
      txHash: result.txHash,
      userReceivedMicroUsdc: result.userReceivedMicroUsdc.toString(),
      comadreFeeMicroUsdc: result.comadreFeeCollectedMicroUsdc.toString(),
    });
  }

  // Providers that required Solana signing are not implemented on Monad.
  return c.json(
    {
      error: "not_implemented",
      message: "On-chain savings confirmation for this provider is not yet available.",
    },
    501,
  );
});

savingsRouter.post("/actions/:id/cancel", async (c) => {
  const actionId = c.req.param("id");
  const user = (c.get as (k: string) => unknown)("user") as AuthUser;
  const rows = await db.select().from(savingsActions).where(eq(savingsActions.id, actionId)).limit(1);
  const action = rows[0];
  if (!action) return c.json({ error: "NOT_FOUND" }, 404);
  if (action.userId !== user.id) return c.json({ error: "FORBIDDEN" }, 403);
  if (action.status !== "pending") return c.json({ error: "INVALID_STATUS", status: action.status }, 409);

  await db.update(savingsActions).set({ status: "cancelled" }).where(eq(savingsActions.id, action.id));
  if (action.unsignedTxKey) await getRedis().del(action.unsignedTxKey).catch(() => undefined);
  return c.json({ actionId: action.id, status: "cancelled" as const });
});

