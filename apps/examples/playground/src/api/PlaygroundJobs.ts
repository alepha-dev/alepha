import { $inject, AlephaError, z } from "alepha";
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

  /**
   * Daily tick — no DB row on success (record: 'error' default).
   */
  public readonly dailyTick = $job({
    description: "Runs daily at midnight — silent on success.",
    cron: "0 0 * * *",
    handler: async () => {
      this.log.info("dailyTick fired", { at: this.dt.nowISOString() });
    },
  });

  /**
   * Hourly tick with full recording — every success kept (up to ring buffer).
   */
  public readonly hourlyTick = $job({
    description: "Runs hourly — records every execution.",
    cron: "0 * * * *",
    record: "all",
    handler: async () => {
      this.log.info("hourlyTick fired");
    },
  });

  /**
   * Cron that always throws — exercises the error-recording path.
   */
  public readonly boomCron = $job({
    description: "Cron that always throws — used to populate error history.",
    cron: "*/15 * * * *",
    handler: async () => {
      throw new AlephaError("boomCron intentionally failed");
    },
  });

  // ---------------------------------------------------------------------------
  // Queue jobs
  // ---------------------------------------------------------------------------

  /**
   * Simple payload → log it. Keeps runs visible (record: 'all').
   */
  public readonly sendMail = $job({
    description: "Pretends to send an email. Every run kept (record: all).",
    schema: z.object({
      to: z.string().meta({ format: "email" }),
      subject: z.string(),
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

  /**
   * Bulk emails — used by the pushMany demo.
   */
  public readonly sendMarketing = $job({
    description: "Marketing email — low priority, keeps successes.",
    schema: z.object({
      to: z.string().meta({ format: "email" }),
      campaign: z.string(),
    }),
    priority: "low",
    record: "all",
    handler: async ({ payload }) => {
      this.log.info("marketing", payload);
    },
  });

  /**
   * Always fails — exercises sweep-driven retries (every ~5 minutes).
   */
  public readonly flaky = $job({
    description: "Always throws — watch the sweep-driven retry cycle.",
    schema: z.object({ v: z.integer() }),
    retry: { retries: 3 },
    handler: async ({ attempt }) => {
      throw new AlephaError(`flaky failed on attempt ${attempt}`);
    },
  });

  /**
   * Takes 10s — lets you exercise cancel + timeout.
   */
  public readonly slow = $job({
    description: "Sleeps 10s — cancel it or let the timeout fire.",
    schema: z.object({ label: z.string() }),
    timeout: [15, "seconds"],
    handler: async ({ signal, payload }) => {
      this.log.info("slow started", payload);
      for (let i = 0; i < 100; i++) {
        if (signal.aborted) {
          this.log.info("slow aborted", { at: i });
          throw new AlephaError("aborted");
        }
        await new Promise((r) => setTimeout(r, 100));
      }
      this.log.info("slow finished", payload);
    },
  });

  /**
   * A two-stage sequence on one execution row: record the intent, then
   * send the reminder two minutes later. The wait is a `reschedule()` of
   * the same row, so the admin shows one execution parked on its second
   * stage rather than two jobs, and a restart inside the wait loses
   * nothing. The abandoned-cart shape, in miniature.
   */
  public readonly reminderSequence = $job({
    description:
      "Records an intent, then reminds two minutes later on the same execution.",
    schema: z.object({
      email: z.string().meta({ format: "email" }),
      stage: z.enum(["recordIntent", "sendReminder"]).optional(),
    }),
    record: "all",
    handler: async ({ payload, reschedule }) => {
      switch (payload.stage ?? "recordIntent") {
        case "recordIntent":
          this.log.info("intent recorded (demo)", { email: payload.email });
          reschedule({
            delay: [2, "minute"],
            payload: { ...payload, stage: "sendReminder" },
          });
          return;
        case "sendReminder":
          this.log.info("reminder sent (demo)", { to: payload.email });
          return;
      }
    },
  });
}
