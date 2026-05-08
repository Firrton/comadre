/**
 * apps/cron — entry point
 *
 * Boots a minimal Hono HTTP server for Railway health checks,
 * then registers all scheduled jobs.
 *
 * Graceful shutdown on SIGTERM: stops all tasks and closes the DB pool.
 */

import { Hono } from "hono";
import type { ScheduledTask } from "node-cron";
import { env } from "@comadre/config";
import { closeDb } from "@comadre/db";
import { logger } from "./lib/logger.js";
import { scheduleJob } from "./lib/scheduler.js";
import { payoutCrank } from "./jobs/payoutCrank.js";
import { disputeResolveCrank } from "./jobs/disputeResolveCrank.js";
import { reminderJob } from "./jobs/reminderJob.js";
import { kycRefreshJob } from "./jobs/kycRefreshJob.js";

// ── Health server ─────────────────────────────────────────────────────────────

const healthApp = new Hono();

healthApp.get("/health", (c) =>
  c.json({
    status: "ok",
    service: "cron",
    timestamp: new Date().toISOString(),
  })
);

const port = (env as Record<string, unknown>)["CRON_PORT"]
  ? Number((env as Record<string, unknown>)["CRON_PORT"])
  : 3005;

const server = Bun.serve({
  port,
  fetch: healthApp.fetch,
});

logger.info({ port }, "cron health server started");

// ── Job registration ──────────────────────────────────────────────────────────

const tasks: ScheduledTask[] = [
  scheduleJob({
    name: "payoutCrank",
    schedule: "*/5 * * * *",
    fn: payoutCrank,
  }),
  scheduleJob({
    name: "disputeResolveCrank",
    schedule: "0 * * * *",
    fn: disputeResolveCrank,
  }),
  scheduleJob({
    name: "reminderJob",
    schedule: "0 9 * * *",
    fn: reminderJob,
  }),
  scheduleJob({
    name: "kycRefreshJob",
    schedule: "0 4 * * *",
    fn: kycRefreshJob,
  }),
];

logger.info({ count: tasks.length }, "all jobs scheduled");

// ── Graceful shutdown ─────────────────────────────────────────────────────────

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, "shutdown signal received");

  for (const task of tasks) {
    task.stop();
  }
  logger.info("all cron tasks stopped");

  await closeDb();
  logger.info("db pool closed");

  server.stop();
  logger.info("health server stopped");

  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
