import { $atom, $hook, $inject, $store, Alepha, type Infer, z } from "alepha";
import { CacheProvider } from "alepha/cache";
import { DateTimeProvider } from "alepha/datetime";
import { $logger } from "alepha/logger";
import { $repository, sql } from "alepha/orm";

import { cacheEntries } from "../entities/cacheEntries.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Configuration atom for {@link DatabaseCacheProvider}.
 */
export const databaseCacheOptions = $atom({
  name: "alepha.cache.database.options",
  schema: z.object({
    sweepProbability: z
      .number()
      .min(0)
      .max(1)
      .describe(
        "Probability (0..1) that a write operation triggers a sweep of expired rows. Set to 0 to disable opportunistic sweeping.",
      )
      .default(0.01),
    sweepBatchSize: z
      .integer()
      .min(1)
      .describe(
        "Maximum number of expired rows deleted per opportunistic sweep.",
      )
      .default(100),
  }),
  default: {
    sweepProbability: 0.01,
    sweepBatchSize: 100,
  },
  serverOnly: true,
});

export type DatabaseCacheOptions = Infer<typeof databaseCacheOptions.schema>;

declare module "alepha" {
  interface State {
    [databaseCacheOptions.key]: DatabaseCacheOptions;
  }
}

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Cache provider backed by the application's SQL database.
 *
 * Uses the `cache_entries` table as a generic key/value store with optional
 * TTL. Works on every database supported by Alepha's ORM (Postgres, SQLite,
 * Cloudflare D1, Bun SQLite).
 *
 * **Why use this over Cloudflare KV / Redis ?**
 *
 * - You already have a SQL database, no extra resource to provision/secure.
 * - `incr()` is **atomic** through `INSERT ... ON CONFLICT DO UPDATE`.
 * - Reads/writes are **strongly consistent** (KV is eventually consistent).
 * - Phase-2 flows (registration, password reset) become transactional with
 *   the user-creation INSERT.
 *
 * **When to prefer Cloudflare KV / Redis instead ?**
 *
 * - Hot read paths where DB latency matters.
 * - Very high write rates where DB pressure becomes a concern.
 *
 * **Storage layout**
 *
 * - `value` column: base64-encoded bytes for `set/get/setTyped/getTyped`.
 * - `count` column: integer counter for atomic `incr()`.
 * - `expiresAt` column: nullable timestamp; expired rows are filtered at read
 *   time and reaped opportunistically on writes.
 *
 * @see {@link CacheProvider}
 */
export class DatabaseCacheProvider extends CacheProvider {
  protected readonly log = $logger();
  protected readonly alepha = $inject(Alepha);
  protected readonly dateTimeProvider = $inject(DateTimeProvider);
  protected readonly repository = $repository(cacheEntries);
  protected readonly options = $store(databaseCacheOptions);

  /**
   * Total writes performed since startup. Useful for tests and metrics.
   */
  public writes = 0;

  /**
   * Total opportunistic sweep cycles executed. Useful for tests.
   */
  public sweeps = 0;

  /**
   * Last error caught while sweeping (sweeps must never throw).
   */
  public lastSweepError?: unknown;

  // -------------------------------------------------------------------------------------------------------------------

  protected readonly onStart = $hook({
    on: "start",
    handler: () => {
      this.log.debug("DatabaseCacheProvider ready");
    },
  });

  // -------------------------------------------------------------------------------------------------------------------

  public async get(name: string, key: string): Promise<Uint8Array | undefined> {
    if (!this.alepha.isStarted()) {
      return undefined;
    }

    const row = await this.repository.findOne({
      where: this.unexpiredWhere(name, key) as any,
    });

    if (!row) {
      return undefined;
    }

    if (row.value != null) {
      return this.fromBase64(row.value);
    }

    if (row.count != null) {
      // The caller wrote the entry through `incr()`. Surface the count via
      // the same byte format that MemoryCacheProvider uses, so `getTyped`
      // returns the number transparently.
      return this.serialize(row.count);
    }

    return undefined;
  }

  public async set(
    name: string,
    key: string,
    value: Uint8Array,
    ttl?: number,
  ): Promise<Uint8Array> {
    if (!this.alepha.isStarted()) {
      return value;
    }

    const expiresAt = this.computeExpiresAt(ttl);

    await this.repository.upsert(
      {
        container: name,
        cacheKey: key,
        value: this.toBase64(value),
        count: null,
        expiresAt,
      } as any,
      {
        target: ["container", "cacheKey"],
        set: {
          value: this.toBase64(value),
          count: null,
          expiresAt,
        },
      },
    );

    this.writes++;
    this.maybeSweep();

    return value;
  }

  public async del(name: string, ...keys: string[]): Promise<void> {
    if (keys.length === 0) {
      await this.repository.deleteMany({
        container: { eq: name },
      });
      return;
    }

    await this.repository.deleteMany({
      container: { eq: name },
      cacheKey: { inArray: keys },
    });
  }

  public async has(name: string, key: string): Promise<boolean> {
    const row = await this.repository.findOne({
      where: this.unexpiredWhere(name, key) as any,
    });
    return row != null;
  }

  public async keys(name: string, filter?: string): Promise<string[]> {
    const baseAnd: any[] = [
      { container: { eq: name } },
      this.unexpiredOrClause(),
    ];
    if (filter) {
      baseAnd.push({ cacheKey: { startsWith: filter } });
    }

    const rows = await this.repository.findMany({
      where: { and: baseAnd } as any,
    });

    return rows.map((row) => row.cacheKey);
  }

  public async clear(): Promise<void> {
    await this.repository.deleteMany({});
  }

  public async incr(
    name: string,
    key: string,
    amount: number,
    ttl?: number,
  ): Promise<number> {
    if (!this.alepha.isStarted()) {
      return amount;
    }

    // TTL semantics (fixed window): `expiresAt` is stamped when the counter
    // is created and NOT extended by increments. An expired row is reaped
    // first so the fresh window starts at zero instead of resurrecting the
    // stale count (the delete is idempotent under concurrency).
    const nowIso = this.dateTimeProvider.nowISOString();
    await this.repository.deleteMany({
      container: { eq: name },
      cacheKey: { eq: key },
      expiresAt: { lt: nowIso },
    } as any);

    // Atomic upsert via `INSERT ... ON CONFLICT (container, cacheKey) DO UPDATE
    // SET count = COALESCE(cache_entries.count, 0) + excluded.count`.
    // Both Postgres and SQLite (incl. D1) support this in a single statement,
    // so concurrent callers can never observe an interleaved read/write.
    const table = this.repository.table;
    const expiresAt = ttl
      ? this.dateTimeProvider.now().add(ttl, "millisecond").toISOString()
      : null;

    const updated = await this.repository.upsert(
      {
        container: name,
        cacheKey: key,
        count: amount,
        value: null,
        expiresAt,
      } as any,
      {
        target: ["container", "cacheKey"],
        set: {
          // `excluded.count` references the value being inserted on conflict.
          // `expiresAt` is deliberately NOT in the set — increments must not
          // extend the window.
          count: sql`coalesce(${table.count}, 0) + ${amount}`,
          value: null,
        },
      },
    );

    this.writes++;
    this.maybeSweep();

    return Number(updated.count ?? amount);
  }

  // -------------------------------------------------------------------------------------------------------------------

  /**
   * Sweep all expired rows in one shot. Useful for tests and for users who
   * want to schedule their own cleanup job.
   */
  public async sweepExpired(): Promise<number> {
    const nowIso = this.dateTimeProvider.nowISOString();
    const ids = await this.repository.deleteMany({
      expiresAt: { lt: nowIso },
    });
    return ids.length;
  }

  // -------------------------------------------------------------------------------------------------------------------

  protected unexpiredOrClause(): Record<string, any> {
    const nowIso = this.dateTimeProvider.nowISOString();
    return {
      or: [{ expiresAt: { isNull: true } }, { expiresAt: { gt: nowIso } }],
    };
  }

  protected unexpiredWhere(name: string, key: string): Record<string, any> {
    return {
      and: [
        { container: { eq: name } },
        { cacheKey: { eq: key } },
        this.unexpiredOrClause(),
      ],
    };
  }

  protected computeExpiresAt(ttl?: number): string | null {
    if (!ttl || ttl <= 0) {
      return null;
    }
    return this.dateTimeProvider
      .of(this.dateTimeProvider.nowMillis() + ttl)
      .toISOString();
  }

  protected toBase64(value: Uint8Array): string {
    return Buffer.from(
      value.buffer as ArrayBuffer,
      value.byteOffset,
      value.byteLength,
    ).toString("base64");
  }

  protected fromBase64(value: string): Uint8Array {
    return new Uint8Array(Buffer.from(value, "base64"));
  }

  /**
   * Run an opportunistic sweep with `sweepProbability` chance per write.
   *
   * Sweep failures are swallowed: cleanup is best-effort, lazy expiration on
   * read keeps correctness regardless. Errors are logged once on `lastSweepError`
   * so tests can assert on them.
   */
  protected maybeSweep(): void {
    const probability = this.options.sweepProbability;
    if (probability <= 0) {
      return;
    }

    if (Math.random() >= probability) {
      return;
    }

    this.runSweep().catch((err) => {
      this.lastSweepError = err;
      this.log.warn("DatabaseCacheProvider sweep failed", err);
    });
  }

  protected async runSweep(): Promise<void> {
    this.sweeps++;
    const nowIso = this.dateTimeProvider.nowISOString();

    // Drizzle does not expose a portable LIMIT on DELETE, so we select first
    // and then delete by ID. Two roundtrips, but only on the ~1% sweep path.
    const expired = await this.repository.findMany({
      where: { expiresAt: { lt: nowIso } },
      columns: ["id"],
      limit: this.options.sweepBatchSize,
    });

    if (expired.length === 0) {
      return;
    }

    await this.repository.deleteMany({
      id: { inArray: expired.map((it) => it.id) },
    });
  }
}
