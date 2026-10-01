import { $inject, $store, AlephaError } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { parseCronExpression } from "cron-schedule";

import type {
  JobPrimitiveOptions,
  JobRetentionOptions,
  JobRetentionRule,
} from "../primitives/$job.ts";
import { jobConfig } from "../schemas/jobConfigAtom.ts";
import type { JobRetention } from "../schemas/jobRetentionSchema.ts";

export type JobCadence = "frequent" | "hourly" | "daily" | "slower";

/**
 * A job's retention with every default filled in: what both run paths, the
 * trim and the admin payload read. `days` may still be a function here; it is
 * evaluated where it is used.
 */
export interface EffectiveRetention {
  ok: JobRetentionRule | false;
  error: JobRetentionRule | false;
  source: { ok: "job" | "default"; error: "job" | "default" };
  cadence?: JobCadence;
}

/**
 * The limits the trim applies to one status of one job, evaluated for this
 * tick.
 */
export interface RetentionLimit {
  last?: number;
  days?: number;
  /**
   * The newest row survives `days` (crons only): a monthly job must never look
   * like it never ran.
   */
  keepNewest: boolean;
}

/**
 * Turns a job's declared `retention` into the rule each status actually
 * follows, once, at registration.
 *
 * It is the single place that knows the defaults, so the inline cron path, the
 * outbox path, the trim and the admin payload cannot disagree about a job. A
 * cron that declares `retry` runs through the outbox like a queue job, and
 * still keeps its successes by its cadence, because the rule is decided by the
 * registration and not by the path that happens to write the row.
 */
export class JobRetentionProvider {
  protected readonly dt = $inject(DateTimeProvider);
  protected readonly config = $store(jobConfig);

  /**
   * The framework's opinion of how many successes a cron keeps, by how often
   * it runs. Upper bounds are inclusive, in minutes. A job overrides it per
   * job; it is not configuration.
   */
  protected readonly cadenceTable: Array<{
    cadence: JobCadence;
    maxGapMinutes: number;
    last: number;
  }> = [
    { cadence: "frequent", maxGapMinutes: 15, last: 12 },
    { cadence: "hourly", maxGapMinutes: 60, last: 24 },
    { cadence: "daily", maxGapMinutes: 24 * 60, last: 7 },
    { cadence: "slower", maxGapMinutes: Number.POSITIVE_INFINITY, last: 5 },
  ];

  /**
   * How many upcoming fire dates the cadence is measured over. Enough for an
   * irregular expression to show its shortest gap: `0 9 * * 1-5` is daily,
   * not "slower", because its weekend gap is not its shortest.
   */
  protected readonly cadenceSamples = 10;

  /**
   * Refuse a rule that cannot mean anything. Throws `AlephaError` naming the
   * job.
   */
  public validate(name: string, retention?: JobRetentionOptions): void {
    if (!retention) return;
    for (const status of ["ok", "error"] as const) {
      const rule = retention[status];
      if (rule === undefined || rule === false) continue;
      if (rule.last === undefined && rule.days === undefined) {
        throw new AlephaError(
          `Job '${name}' declares retention.${status} with neither 'last' nor 'days'. Say how many rows or how many days to keep, or pass false to record none.`,
        );
      }
      if (
        rule.last !== undefined &&
        !(Number.isInteger(rule.last) && rule.last >= 1)
      ) {
        throw new AlephaError(
          `Job '${name}' declares retention.${status}.last = ${rule.last}. 'last' is an integer of at least 1; pass false to record none.`,
        );
      }
      if (typeof rule.days === "number" && !(rule.days > 0)) {
        throw new AlephaError(
          `Job '${name}' declares retention.${status}.days = ${rule.days}. 'days' is a positive number; pass false to record none.`,
        );
      }
    }
  }

  /**
   * The effective rule of every status. Call once, at registration: the cron
   * cadence is measured here.
   */
  public resolve(
    name: string,
    options: JobPrimitiveOptions,
  ): EffectiveRetention {
    this.validate(name, options.retention);

    const cadence = options.cron
      ? this.cadenceOf(name, options.cron)
      : undefined;
    const declared = options.retention ?? {};

    const defaultOk: JobRetentionRule | false = cadence
      ? { last: this.cadenceTable.find((c) => c.cadence === cadence)!.last }
      : false;
    // A function, so an app that tunes `errorDays` after registration still
    // gets the value it set.
    const defaultError: JobRetentionRule = {
      days: () => this.config.retention.errorDays,
    };

    return {
      ok: declared.ok !== undefined ? declared.ok : defaultOk,
      error: declared.error !== undefined ? declared.error : defaultError,
      source: {
        ok: declared.ok !== undefined ? "job" : "default",
        error: declared.error !== undefined ? "job" : "default",
      },
      cadence,
    };
  }

  /**
   * The cadence bucket of a cron expression: the shortest gap among its next
   * fire dates.
   */
  public cadenceOf(name: string, expression: string): JobCadence {
    let dates: Date[];
    try {
      dates = parseCronExpression(expression).getNextDates(
        this.cadenceSamples,
        this.dt.now().toDate(),
      );
    } catch (error) {
      throw new AlephaError(
        `Invalid cron expression '${expression}' for job '${name}'`,
        { cause: error },
      );
    }
    let shortest = Number.POSITIVE_INFINITY;
    for (let i = 1; i < dates.length; i++) {
      shortest = Math.min(
        shortest,
        dates[i].getTime() - dates[i - 1].getTime(),
      );
    }
    const minutes = shortest / 60_000;
    return this.cadenceTable.find((c) => minutes <= c.maxGapMinutes)!.cadence;
  }

  /**
   * The rule a status follows. `cancelled` follows `error`.
   */
  public ruleFor(
    retention: EffectiveRetention,
    status: "ok" | "error" | "cancelled",
  ): JobRetentionRule | false {
    return status === "ok" ? retention.ok : retention.error;
  }

  /**
   * Whether rows of this status are written at all.
   */
  public records(
    retention: EffectiveRetention,
    status: "ok" | "error" | "cancelled",
  ): boolean {
    return this.ruleFor(retention, status) !== false;
  }

  /**
   * What the trim applies to one status this tick, or `false` when every row
   * of that status goes. `maxRows` caps a default rule only.
   */
  public limitFor(
    retention: EffectiveRetention,
    kind: "cron" | "queue",
    status: "ok" | "error" | "cancelled",
  ): RetentionLimit | false {
    const rule = this.ruleFor(retention, status);
    if (rule === false) return false;
    const source =
      status === "ok" ? retention.source.ok : retention.source.error;
    const cap =
      source === "default" ? this.config.retention.maxRows : undefined;
    const last =
      cap === undefined
        ? rule.last
        : Math.min(rule.last ?? Number.POSITIVE_INFINITY, cap);
    return {
      last,
      days: this.daysOf(rule),
      keepNewest: kind === "cron",
    };
  }

  /**
   * The admin payload: the same rules, with `days` evaluated now.
   */
  public describe(retention: EffectiveRetention): JobRetention {
    const plain = (rule: JobRetentionRule | false) => {
      if (rule === false) return false as const;
      const days = this.daysOf(rule);
      return {
        ...(rule.last !== undefined ? { last: rule.last } : {}),
        ...(days !== undefined ? { days } : {}),
      };
    };
    return {
      ok: plain(retention.ok),
      error: plain(retention.error),
      source: { ...retention.source },
      ...(retention.cadence ? { cadence: retention.cadence } : {}),
    };
  }

  /**
   * `days`, evaluated. A function that returns something other than a
   * positive number (a parameter edited to nonsense) is read as no age limit
   * rather than as "everything is too old".
   */
  protected daysOf(rule: JobRetentionRule): number | undefined {
    if (rule.days === undefined) return undefined;
    const days = typeof rule.days === "function" ? rule.days() : rule.days;
    return Number.isFinite(days) && days > 0 ? days : undefined;
  }
}
