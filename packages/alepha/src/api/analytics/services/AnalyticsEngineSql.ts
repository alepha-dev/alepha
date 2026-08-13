import { AlephaError } from "alepha";

export interface AnalyticsEngineSqlOptions {
  accountId: string;
  /**
   * An API token scoped **Account · Account Analytics · Read**.
   *
   * Read `AnalyticsEngineSql`'s docstring before putting one in a Worker that
   * also serves public endpoints — this credential is account-wide and cannot
   * be scoped to a single dataset.
   */
  token: string;
  /** Override for tests. Defaults to the real Cloudflare endpoint. */
  endpoint?: string;
  /** Injected so a caller can supply a Worker-bound or instrumented fetch. */
  fetch?: typeof globalThis.fetch;
}

/**
 * One row as the SQL API returns it: fields are addressed **positionally**,
 * `blob1…blob20` and `double1…double20`, whatever the `SELECT` called them.
 */
export type AnalyticsEngineRow = Record<string, string | number | null>;

interface SqlApiResponse {
  data?: AnalyticsEngineRow[];
  rows?: number;
  meta?: Array<{ name: string; type: string }>;
  errors?: Array<{ message?: string }>;
  /** Present on an envelope-shaped error response rather than a raw result. */
  success?: boolean;
}

/**
 * The read half of Workers Analytics Engine.
 *
 * ## It is HTTP, not a binding
 *
 * The `analytics_engine_datasets` binding is **write-only** —
 * `writeDataPoint()` and nothing else. Reading goes to
 * `POST /accounts/{account_id}/analytics_engine/sql` with a bearer token, so
 * the two halves of one dataset are reached by two entirely different
 * mechanisms and hold two entirely different credentials.
 *
 * ## ⚠️ The token is account-scoped
 *
 * Cloudflare has no dataset-scoped analytics read permission: the smallest
 * grant that can run this query is **Account · Account Analytics · Read**,
 * which reads every dataset in the account. Putting one in a Worker that also
 * serves unauthenticated endpoints means an RCE-equivalent bug on those
 * endpoints exposes account-wide analytics, not just this app's.
 *
 * That is a real widening and worth stating rather than discovering. Two
 * mitigations, in order of preference:
 *
 * 1. **Do not put it in the public Worker.** The read path serves an
 *    authenticated dashboard, so it can live behind a separate Worker (or a
 *    scheduled job) that no anonymous request ever reaches.
 * 2. If it must share a Worker, keep the blast radius small by giving the
 *    account nothing else worth reading — which is not a control, only an
 *    accident of how the account is used, and stops being true the moment a
 *    second product lands there.
 *
 * Neither is a substitute for the fact that the credential cannot be narrowed.
 *
 * ## Every count read back is an estimate
 *
 * Analytics Engine samples. `_sample_interval` is how many real events each
 * stored row stands for, and it **varies per row** — a constant multiplier is
 * wrong. Corrections are not optional:
 *
 * - counts: `sum(_sample_interval)`, never `count()`
 * - sums: `sum(x * _sample_interval)`
 * - quantiles: `quantileExactWeighted(0.75)(double1, _sample_interval)`
 *
 * `count(DISTINCT …)` **cannot be corrected at all** — no weighting recovers
 * a distinct count from a sample. That is why unique visitors stay in a
 * relational store; see `AnalyticsStore`.
 */
export class AnalyticsEngineSql {
  protected readonly options: AnalyticsEngineSqlOptions;

  constructor(options: AnalyticsEngineSqlOptions) {
    this.options = options;
  }

  /**
   * Run one query and return its rows.
   *
   * The API speaks SQL as a plain text body — there is no parameter binding,
   * so anything interpolated has to be quoted by the caller. {@link quote} is
   * the only sanctioned way to do that.
   */
  async query(sql: string): Promise<AnalyticsEngineRow[]> {
    const endpoint =
      this.options.endpoint ??
      `https://api.cloudflare.com/client/v4/accounts/${this.options.accountId}/analytics_engine/sql`;
    const doFetch = this.options.fetch ?? globalThis.fetch;

    const response = await doFetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.options.token}`,
        "Content-Type": "text/plain",
      },
      body: sql,
    });

    if (!response.ok) {
      // The body carries the actual complaint (bad column, unknown dataset,
      // insufficient token scope); the status alone says none of that.
      const detail = await response.text().catch(() => "");
      throw new AlephaError(
        `Analytics Engine SQL failed (${response.status}): ${detail.slice(0, 500)}`,
      );
    }

    const payload = (await response.json()) as SqlApiResponse;
    if (payload.errors?.length) {
      throw new AlephaError(
        `Analytics Engine SQL failed: ${payload.errors
          .map((e) => e.message ?? "unknown")
          .join("; ")}`,
      );
    }
    return payload.data ?? [];
  }

  /**
   * Quote a value for interpolation into a query.
   *
   * There is no bind-parameter protocol on this endpoint, so every literal is
   * concatenated into the statement — which makes this the one place injection
   * can be prevented. Numbers are emitted bare after a finiteness check;
   * strings are single-quoted with backslashes and quotes escaped.
   */
  static quote(value: string | number): string {
    if (typeof value === "number") {
      if (!Number.isFinite(value)) {
        throw new AlephaError(
          `Refusing to interpolate a non-finite number into SQL: ${value}`,
        );
      }
      return String(value);
    }
    return `'${value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
  }

  /**
   * Quote an identifier — a dataset name in a `FROM` clause.
   *
   * Distinct from {@link quote}, which quotes *values*. Identifiers use double
   * quotes; single quotes would make the name a string literal, and backticks
   * are rejected outright by this dialect.
   *
   * Not optional, and this cost a production 422 to learn. Dataset names are
   * derived from the deployment prefix, so `lore-production` is typical — and
   * a bare hyphen parses as subtraction:
   *
   * ```
   * FROM lore-production   → 422 sql parser error: Expected end of statement, found: -
   * FROM `lore-production` → 422 sql parser error: Expected identifier, found: `
   * FROM "lore-production" → 200
   * ```
   *
   * No fake can catch this: it is the real endpoint's parser that rejects it.
   */
  static quoteIdentifier(name: string): string {
    return `"${name.replace(/"/g, '""')}"`;
  }

  /** `IN (…)` list, each element quoted. Empty stays empty — see the caller. */
  static quoteList(values: Array<string | number>): string {
    return values.map((value) => AnalyticsEngineSql.quote(value)).join(", ");
  }

  /**
   * Read a positional column off a row, as a number.
   *
   * Results address fields as `blob1…blob20` / `double1…double20` regardless
   * of the alias in the `SELECT`, and the API returns numeric aggregates as
   * either numbers or numeric strings depending on the function. One coercion
   * in one place beats a `Number(...)` at every call site.
   */
  static num(row: AnalyticsEngineRow, key: string): number {
    const value = row[key];
    if (value === null || value === undefined) return 0;
    const parsed = typeof value === "number" ? value : Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  /** Read a positional column off a row, as a string. */
  static str(row: AnalyticsEngineRow, key: string): string {
    const value = row[key];
    return value === null || value === undefined ? "" : String(value);
  }
}
