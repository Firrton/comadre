/**
 * Decides if Comadre should proactively nudge about Guardadito this turn.
 *
 * Triggers (any one):
 *   - User says a greeting ("hola", "buenas", etc.)
 *   - The previous turn(s) include a successful tanda creation tool result
 *     (so we suggest after they finish creating a tanda)
 *
 * Cooldown: only one nudge per user per 24h, tracked in savings_nudges.
 */
import { and, eq, gte } from "drizzle-orm";
import { db, savingsNudges } from "@comadre/db";
import type { ChatMessage } from "../agentLoop.js";

const GREETING_RE = /^\s*(hola|holi|holis|buenas|buen\s+d[ií]a|buen\s+d[ií]as|qu[eé]\s+tal|saludos|hey|ey|que onda|cómo est[áa]s|como estas)\b/i;
const NUDGE_COOLDOWN_HOURS = 24;
const NUDGE_COOLDOWN_MS = NUDGE_COOLDOWN_HOURS * 3600 * 1000;

export function isGreeting(msg: string): boolean {
  return GREETING_RE.test(msg.trim());
}

/**
 * Detect that the latest few turns include a successful tanda creation
 * (tool message with tanda_id + signature).
 */
export function isPostTandaCreation(history: ChatMessage[]): boolean {
  const lookback = history.slice(-6);
  for (const m of lookback) {
    if (m.role === "tool" && typeof m.content === "string") {
      if (m.content.includes('"tanda_id"') && m.content.includes('"signature"')) {
        return true;
      }
    }
  }
  return false;
}

export async function recentNudgeExists(userWallet: string): Promise<boolean> {
  const cutoff = new Date(Date.now() - NUDGE_COOLDOWN_MS);
  const rows = await db
    .select({ id: savingsNudges.id })
    .from(savingsNudges)
    .where(and(eq(savingsNudges.userWallet, userWallet), gte(savingsNudges.createdAt, cutoff)))
    .limit(1);
  return rows.length > 0;
}

export type NudgeSource = "greeting" | "post_tanda";

export async function shouldNudgeGuardadito(args: {
  userWallet: string;
  userMessage: string;
  history: ChatMessage[];
}): Promise<{ ok: boolean; source: NudgeSource | null }> {
  let source: NudgeSource | null = null;
  if (isGreeting(args.userMessage)) source = "greeting";
  else if (isPostTandaCreation(args.history)) source = "post_tanda";

  if (source === null) return { ok: false, source: null };
  if (await recentNudgeExists(args.userWallet)) return { ok: false, source };
  return { ok: true, source };
}

/** Insert a nudge row to start the 24h cooldown. */
export async function recordGuardaditoNudge(params: {
  userWallet: string;
  source: NudgeSource;
  amountMicroUsdc: bigint;
  message?: string;
}): Promise<void> {
  await db.insert(savingsNudges).values({
    userWallet: params.userWallet,
    source: params.source,
    sourceRef: `${params.source}:${Date.now()}`,
    amountMicroUsdc: params.amountMicroUsdc,
    status: "delivered",
    message: params.message ?? null,
    createdAt: new Date(),
  });
}
