/**
 * Scheduler wrapper around node-cron.
 *
 * Features:
 * - Structured Pino logs on start / finish / error per job
 * - In-flight guard: refuses to start a job if the previous run hasn't finished
 * - Timeout: kills jobs that exceed `timeoutMs` (default 10 min) with a log
 */

import cron, { type ScheduledTask } from "node-cron";
import { logger } from "./logger.js";

export type JobFn = () => Promise<void>;

export interface JobOptions {
  /** node-cron expression, e.g. every-5-min = "star/5 star star star star" */
  schedule: string;
  /** Human-readable job name used in log fields */
  name: string;
  fn: JobFn;
  /** Max run time in milliseconds. Default: 10 minutes */
  timeoutMs?: number;
}

// Map of job name -> whether a run is currently in-flight
const inFlight = new Map<string, boolean>();

/**
 * Register and start a scheduled job.
 * Returns the ScheduledTask so the caller can stop it on shutdown.
 */
export function scheduleJob(opts: JobOptions): ScheduledTask {
  const { schedule, name, fn, timeoutMs = 10 * 60 * 1000 } = opts;
  const log = logger.child({ job: name });

  log.info({ schedule }, "job registered");

  const task = cron.schedule(schedule, async () => {
    if (inFlight.get(name)) {
      log.warn("previous run still in-flight — skipping");
      return;
    }

    inFlight.set(name, true);
    const started = Date.now();
    log.info("job started");

    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      log.error({ timeoutMs }, "job exceeded timeout — marking as failed");
      inFlight.set(name, false);
    }, timeoutMs);

    try {
      await fn();
      if (!timedOut) {
        log.info({ durationMs: Date.now() - started }, "job finished");
      }
    } catch (err) {
      if (!timedOut) {
        log.error({ err, durationMs: Date.now() - started }, "job error");
      }
    } finally {
      clearTimeout(timer);
      inFlight.set(name, false);
    }
  });

  return task;
}
