import type { Page } from "alepha";
import type {
  JobExecutionQuery,
  JobExecutionResource,
  JobExecutionRow,
  JobRegistration,
} from "alepha/api/jobs";

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
        name: "digests.send-weekly",
        description: "Emails the weekly digest to every subscriber.",
        type: "cron",
        cron: "0 7 * * 1",
        timeout: "5m",
        retry: { retries: 3 },
        retention: {
          ok: { last: 5 },
          error: { days: 30 },
          source: { ok: "default", error: "default" },
          cadence: "slower",
        },
        recent: { ok: 41, error: 1, lastRun: this.at(1), lastStatus: "ok" },
      },
      {
        name: "search.rebuild-index",
        description: "Rewrites the search index from scratch.",
        type: "cron",
        cron: "0 3 * * *",
        timeout: "30m",
        retention: {
          ok: { last: 7 },
          error: { days: 30 },
          source: { ok: "default", error: "default" },
          cadence: "daily",
        },
        recent: { ok: 12, error: 0, lastRun: this.at(9), lastStatus: "ok" },
      },
      {
        name: "images.make-thumbnail",
        description: "Generates a thumbnail for an uploaded image.",
        type: "queue",
        retry: { retries: 5 },
        retention: {
          ok: false,
          error: { days: 30 },
          source: { ok: "default", error: "default" },
        },
        recent: {
          ok: 1284,
          error: 7,
          lastRun: this.at(0.2),
          lastStatus: "error",
        },
      },
      {
        name: "invoices.settle",
        description: "Charges a due invoice and records the result.",
        type: "direct",
        timeout: "1m",
        retry: { retries: 2 },
        retention: {
          ok: { days: 30 },
          error: { days: 90 },
          source: { ok: "job", error: "job" },
        },
        recent: { ok: 96, error: 3, lastRun: this.at(2), lastStatus: "ok" },
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
        status,
        attempt: status === "error" ? 3 : 1,
        maxAttempts: 3,
        redispatchCount: 0,
        payload: { subscriberId: `sub_${String(i + 1).padStart(4, "0")}` },
        scheduledAt: status === "scheduled" ? this.at(-1) : undefined,
        startedAt: pending ? undefined : this.at(hoursAgo + 0.05),
        completedAt:
          settled || status === "cancelled" ? this.at(hoursAgo) : undefined,
        error: status === "error" ? "SMTP refused the connection" : undefined,
        // Every finished run keeps its log, successes included; a run still
        // in progress has written nothing yet.
        logs:
          settled || status === "cancelled"
            ? this.logs(jobName, status, hoursAgo)
            : undefined,
        triggeredByName: i % 3 === 0 ? "Ada Lovelace" : undefined,
        can: {
          retry: status === "error" || status === "cancelled",
          cancel: status === "running" || pending,
          delete: settled || status === "cancelled",
        },
      };
    }) as unknown as JobExecutionResource[];
  }

  /**
   * One page of a job's executions, filtered and sorted the way the real
   * endpoint does, without the payload and logs a list row does not carry.
   */
  public page(
    jobName: string,
    query: JobExecutionQuery,
  ): Page<JobExecutionRow> {
    const size = Number(query.size ?? 10);
    const number = Number(query.page ?? 0);

    let rows = this.executions(jobName);
    if (query.status?.length) {
      rows = rows.filter((r) => query.status!.includes(r.status));
    }
    if (query.trigger) {
      rows = rows.filter((r) =>
        query.trigger === "scheduled"
          ? r.triggeredBy === "system"
          : query.trigger === "manual"
            ? r.triggeredBy !== undefined && r.triggeredBy !== "system"
            : r.triggeredBy === undefined,
      );
    }
    if (query.key) {
      const key = query.key.toLowerCase();
      rows = rows.filter((r) => r.key?.toLowerCase().includes(key));
    }
    if (query.from) {
      rows = rows.filter((r) => !!r.startedAt && r.startedAt >= query.from!);
    }
    if (query.to) {
      rows = rows.filter((r) => !!r.startedAt && r.startedAt <= query.to!);
    }

    const sort = query.sort ?? "-createdAt";
    const desc = sort.startsWith("-");
    const field = (desc ? sort.slice(1) : sort) as
      | "createdAt"
      | "startedAt"
      | "completedAt"
      | "status"
      | "attempt";
    const valueOf = (row: JobExecutionResource): string =>
      field === "attempt"
        ? String(row.attempt).padStart(6, "0")
        : (row[field] ?? "");
    rows = [...rows].sort((a, b) => {
      const av = valueOf(a);
      const bv = valueOf(b);
      const primary = av < bv ? -1 : av > bv ? 1 : 0;
      if (primary !== 0) return desc ? -primary : primary;
      return a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0;
    });

    const offset = number * size;
    const content = rows
      .slice(offset, offset + size)
      .map(({ payload: _payload, logs: _logs, ...row }) => row);
    const totalPages = Math.max(1, Math.ceil(rows.length / size));

    return {
      content,
      page: {
        number,
        size,
        offset,
        numberOfElements: content.length,
        totalElements: rows.length,
        totalPages,
        isEmpty: content.length === 0,
        isFirst: number === 0,
        isLast: number >= totalPages - 1,
      },
    };
  }

  /**
   * One execution by id, whatever job it belongs to, or `undefined`.
   */
  public execution(id: string): JobExecutionResource | undefined {
    for (const job of this.registrations()) {
      const found = this.executions(job.name).find((r) => r.id === id);
      if (found) return found;
    }
    return undefined;
  }

  /**
   * The log a finished run kept: what it did, and why it stopped when it
   * failed.
   */
  protected logs(
    jobName: string,
    status: JobExecutionStatus,
    hoursAgo: number,
  ): JobExecutionResource["logs"] {
    const at = (offsetSeconds: number) =>
      Date.parse(this.at(hoursAgo + 0.05)) + offsetSeconds * 1000;
    const entries: NonNullable<JobExecutionResource["logs"]> = [
      {
        level: "INFO",
        message: `Starting ${jobName}`,
        service: "showcase",
        module: "jobs",
        timestamp: at(0),
      },
      {
        level: "DEBUG",
        message: "Loaded 128 subscribers",
        service: "showcase",
        module: "jobs",
        timestamp: at(1),
        data: { batch: 1 },
      },
    ];
    if (status === "error") {
      entries.push({
        level: "ERROR",
        message: "SMTP refused the connection",
        service: "showcase",
        module: "mail",
        timestamp: at(2),
      });
    } else if (status === "cancelled") {
      entries.push({
        level: "WARN",
        message: "Cancelled by an operator",
        service: "showcase",
        module: "jobs",
        timestamp: at(2),
      });
    } else {
      entries.push({
        level: "INFO",
        message: "Sent 128 digests",
        service: "showcase",
        module: "jobs",
        timestamp: at(3),
      });
    }
    return entries;
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
