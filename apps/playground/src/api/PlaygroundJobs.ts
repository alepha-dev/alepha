import { $inject, t } from "alepha";
import { $job } from "alepha/api/jobs";
import { DateTimeProvider } from "alepha/datetime";
import { $logger } from "alepha/logger";

/**
 * A handful of jobs covering every feature the new $job primitive supports.
 * The UI drives them via `PlaygroundController`.
 */
export class PlaygroundJobs {
  protected readonly log = $logger();
  protected readonly dt = $inject(DateTimeProvider);

  // ---------------------------------------------------------------------------
  // Cron jobs
  // ---------------------------------------------------------------------------

  /** Daily tick — no DB row on success (record: 'error' default). */
  public readonly dailyTick = $job({
    description: "Runs daily at midnight — silent on success.",
    cron: "0 0 * * *",
    handler: async () => {
      this.log.info("dailyTick fired", { at: this.dt.nowISOString() });
    },
  });

  /** Hourly tick with full recording — every success kept (up to ring buffer). */
  public readonly hourlyTick = $job({
    description: "Runs hourly — records every execution.",
    cron: "0 * * * *",
    record: "all",
    handler: async () => {
      this.log.info("hourlyTick fired");
    },
  });

  /** Cron that always throws — exercises the error-recording path. */
  public readonly boomCron = $job({
    description: "Cron that always throws — used to populate error history.",
    cron: "*/15 * * * *",
    handler: async () => {
      throw new Error("boomCron intentionally failed");
    },
  });

  // ---------------------------------------------------------------------------
  // Queue jobs
  // ---------------------------------------------------------------------------

  /** Simple payload → log it. Keeps runs visible (record: 'all'). */
  public readonly sendMail = $job({
    description: "Pretends to send an email. Every run kept (record: all).",
    schema: t.object({
      to: t.string({ format: "email" }),
      subject: t.string(),
    }),
    timeout: [10, "seconds"],
    record: "all",
    handler: async ({ payload }) => {
      this.log.info("sending mail", {
        to: payload.to,
        subject: payload.subject,
      });
      // Simulate a bit of work
      await new Promise((r) => setTimeout(r, 100));
    },
  });

  /** Bulk emails — used by the pushMany demo. */
  public readonly sendMarketing = $job({
    description: "Marketing email — low priority, keeps successes.",
    schema: t.object({
      to: t.string({ format: "email" }),
      campaign: t.string(),
    }),
    priority: "low",
    record: "all",
    handler: async ({ payload }) => {
      this.log.info("marketing", payload);
    },
  });

  /** Always fails — exercises sweep-driven retries (every ~5 minutes). */
  public readonly flaky = $job({
    description: "Always throws — watch the sweep-driven retry cycle.",
    schema: t.object({ v: t.integer() }),
    retry: { retries: 3 },
    handler: async ({ attempt }) => {
      throw new Error(`flaky failed on attempt ${attempt}`);
    },
  });

  /** Takes 10s — lets you exercise cancel + timeout. */
  public readonly slow = $job({
    description: "Sleeps 10s — cancel it or let the timeout fire.",
    schema: t.object({ label: t.string() }),
    timeout: [15, "seconds"],
    handler: async ({ signal, payload }) => {
      this.log.info("slow started", payload);
      for (let i = 0; i < 100; i++) {
        if (signal.aborted) {
          this.log.info("slow aborted", { at: i });
          throw new Error("aborted");
        }
        await new Promise((r) => setTimeout(r, 100));
      }
      this.log.info("slow finished", payload);
    },
  });
}
