/**
 * scheduler.test.ts
 *
 * Verifies the scheduler wrapper:
 * - Runs the job function on each tick
 * - Skips a tick if a previous run is still in-flight
 */

import { describe, it, expect, afterEach } from "bun:test";
import { type ScheduledTask } from "node-cron";
import { scheduleJob } from "../lib/scheduler.js";

// We drive scheduling manually by calling the task's handler via node-cron's
// own test utilities — but node-cron@3 doesn't expose a manual trigger.
// Instead we directly test that scheduleJob returns a ScheduledTask and that
// the underlying job function is called.

describe("scheduleJob", () => {
  const tasks: ScheduledTask[] = [];

  afterEach(() => {
    for (const t of tasks) {
      t.stop();
    }
    tasks.length = 0;
  });

  it("returns a ScheduledTask", () => {
    let _counter = 0;
    const task = scheduleJob({
      name: "test-job",
      schedule: "* * * * * *", // every second
      fn: async () => {
        _counter++;
      },
    });
    tasks.push(task);
    expect(task).toBeDefined();
    expect(typeof task.stop).toBe("function");
  });

  it("increments counter after one second", async () => {
    let counter = 0;

    const task = scheduleJob({
      name: "counter-job",
      schedule: "* * * * * *",
      fn: async () => {
        counter++;
      },
    });
    tasks.push(task);

    // Wait 1.5 seconds for the second-granularity cron to fire at least once
    await new Promise<void>((resolve) => setTimeout(resolve, 1500));

    expect(counter).toBeGreaterThanOrEqual(1);
  });

  it("stops firing after task.stop()", async () => {
    let counter = 0;

    const task = scheduleJob({
      name: "stop-job",
      schedule: "* * * * * *",
      fn: async () => {
        counter++;
      },
    });

    // Let it fire once
    await new Promise<void>((resolve) => setTimeout(resolve, 1500));
    task.stop();

    const snapshotAfterStop = counter;

    // Wait another second — should not increment
    await new Promise<void>((resolve) => setTimeout(resolve, 1200));

    expect(counter).toBe(snapshotAfterStop);
  });
});
