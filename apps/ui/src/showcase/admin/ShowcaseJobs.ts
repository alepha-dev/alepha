import type { JobExecutionResource, JobRegistration } from "alepha/api/jobs";

/**
 * The execution statuses the entity actually declares. Written out rather than
 * inferred so a fixture cannot invent one: `completed` and `failed` look right
 * and are not in the enum.
 */
type JobExecutionStatus =
  | "pending"
  | "running"
  | "scheduled"
  | "ok"
  | "error"
  | "cancelled";

/**
 * A fake job registry and its execution history.
 *
 * Typed as the REAL `JobRegistration` and `JobExecutionResource`, so a field
 * added upstream stops this compiling rather than blanking a column.
 */
export class ShowcaseJobs {
  public registrations(): JobRegistration[] {
    return [
      {
        name: "ShowcaseJobs.sendDigest",
        description: "Emails the weekly digest to every subscriber.",
        type: "cron",
        priority: "normal",
        cron: "0 7 * * 1",
        timeout: "5m",
        retry: { retries: 3 },
        recent: { ok: 41, error: 1, lastRun: this.at(1) },
      },
      {
        name: "ShowcaseJobs.rebuildSearchIndex",
        description: "Rewrites the search index from scratch.",
        type: "cron",
        priority: "low",
        cron: "0 3 * * *",
        timeout: "30m",
        recent: { ok: 12, error: 0, lastRun: this.at(9) },
      },
      {
        name: "ShowcaseJobs.thumbnail",
        description: "Generates a thumbnail for an uploaded image.",
        type: "queue",
        priority: "high",
        retry: { retries: 5 },
        recent: { ok: 1284, error: 7, lastRun: this.at(0.2) },
      },
      {
        name: "ShowcaseJobs.settleInvoice",
        description: "Charges a due invoice and records the result.",
        type: "direct",
        priority: "critical",
        timeout: "1m",
        retry: { retries: 2 },
        recent: { ok: 96, error: 3, lastRun: this.at(2) },
      },
    ];
  }

  /**
   * Executions for one job. Deliberately mixes statuses so the status badge,
   * the retry affordance and the cancel affordance all have a row to appear
   * on: `can` is what the panel reads to decide which buttons to show.
   */
  public executions(jobName: string): JobExecutionResource[] {
    // ⚠️ The status enum is `ok` / `error`, NOT `completed` / `failed`, and
    // the row's key is `jobName`, its counter is `attempt` (singular) and its
    // end stamp is `completedAt`. Every one of those was wrong on the first
    // draft, and the response schema is what said so: borrowing the real
    // `jobExecutionResourceSchema` turned a page that would have rendered
    // blank into a failing test.
    const seed: [JobExecutionStatus, number][] = [
      ["ok", 0.2],
      ["ok", 1.1],
      ["error", 2.4],
      ["running", 0.05],
      ["pending", 0],
      ["cancelled", 5.2],
      ["scheduled", -1],
      ["ok", 7.9],
    ];

    return seed.map(([status, hoursAgo], i) => {
      const pending = status === "pending" || status === "scheduled";
      const settled = status === "ok" || status === "error";
      return {
        id: `00000000-0000-4000-9000-${String(i + 1).padStart(12, "0")}`,
        createdAt: this.at(hoursAgo + 0.1),
        updatedAt: this.at(hoursAgo),
        jobName,
        key: undefined,
        organizationId: undefined,
        status,
        priority: i % 4 === 0 ? "high" : "normal",
        attempt: status === "error" ? 3 : 1,
        maxAttempts: 3,
        redispatchCount: 0,
        payload: { subscriberId: `sub_${String(i + 1).padStart(4, "0")}` },
        scheduledAt: status === "scheduled" ? this.at(-1) : undefined,
        startedAt: pending ? undefined : this.at(hoursAgo + 0.05),
        completedAt:
          settled || status === "cancelled" ? this.at(hoursAgo) : undefined,
        error: status === "error" ? "SMTP refused the connection" : undefined,
        triggeredByName: i % 3 === 0 ? "Ada Lovelace" : undefined,
        can: {
          retry: status === "error" || status === "cancelled",
          cancel: status === "running" || pending,
        },
      };
    }) as unknown as JobExecutionResource[];
  }

  /**
   * A fixed clock. `Date.now()` is banned repo-wide, and a moving one would
   * also make every prerender emit different HTML.
   */
  protected at(hoursAgo: number): string {
    const base = Date.UTC(2026, 8, 5, 9, 0);
    return new Date(base - hoursAgo * 3_600_000).toISOString();
  }
}
