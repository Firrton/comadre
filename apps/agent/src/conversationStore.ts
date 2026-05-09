import { Redis } from "@upstash/redis";

import { env } from "@comadre/config";

import type { ChatMessage } from "./agentLoop.js";

const redis = new Redis({
  url: env.UPSTASH_REDIS_REST_URL,
  token: env.UPSTASH_REDIS_REST_TOKEN,
});

const TTL_SECONDS = 24 * 60 * 60; // 24h
const KEY_PREFIX = "agent:conv:";
const MAX_HISTORY = 20; // last 20 messages — enough context, bounded cost

function key(conversationKey: string): string {
  return `${KEY_PREFIX}${conversationKey}`;
}

export async function loadHistory(
  conversationKey: string,
): Promise<ChatMessage[]> {
  const raw = await redis.get<ChatMessage[]>(key(conversationKey));
  return Array.isArray(raw) ? raw : [];
}

export async function saveHistory(
  conversationKey: string,
  messages: ChatMessage[],
): Promise<void> {
  // Trim to last MAX_HISTORY to keep cost bounded
  const trimmed = messages.slice(-MAX_HISTORY);
  await redis.set(key(conversationKey), trimmed, { ex: TTL_SECONDS });
}
