import { $inject } from "alepha";
import { CryptoProvider } from "alepha/crypto";
import { sql } from "drizzle-orm";

import { alephaSequences } from "../entities/alephaSequences.ts";
import { $repository } from "../primitives/$repository.ts";

/**
 * Portable, scoped numeric sequence provider - works identically on Postgres,
 * SQLite, and Cloudflare D1.
 *
 * Implementation: a single `alepha_sequences` table holds one row per
 * `(name, scope)` pair. Every call to {@link advance} runs an
 * `INSERT ... ON CONFLICT (name, scope) DO UPDATE SET value = value + step`
 * with `RETURNING value`, which is atomic on every supported driver:
 *
 * - **Postgres**: row-level lock on `ON CONFLICT DO UPDATE`.
 * - **SQLite / D1**: writes are serialized, atomic by construction.
 *
 * The repository pattern is the same one used by `DatabaseCacheProvider.incr()`;
 * see that file for the proof-of-design.
 *
 * Callers never instantiate this directly. They declare a {@link SequencePrimitive}
 * via `$sequence()` and call `.next(scope?)` on the primitive - this provider is
 * the engine behind that call.
 */
export class SequenceProvider {
  protected readonly repository = $repository(alephaSequences);
  protected readonly crypto = $inject(CryptoProvider);

  /**
   * Atomically advance the counter for `(name, scope)` and return the new value.
   *
   * If the row doesn't exist yet, it's inserted with `value = start` and that
   * value is returned. Subsequent calls increment by `step`.
   *
   * Scope defaults to "default" — pass any string to namespace per
   * tenant / campaign / parent entity / etc.
   */
  public async advance(
    name: string,
    scope: string = "default",
    opts: { startWith?: number; incrementBy?: number } = {},
  ): Promise<number> {
    const start = opts.startWith ?? 1;
    const step = opts.incrementBy ?? 1;
    const table = this.repository.table;

    const updated = await this.repository.upsert(
      {
        id: this.crypto.randomUUID(),
        name,
        scope,
        value: start,
      },
      {
        target: ["name", "scope"],
        set: {
          // Atomic: `value = current_value + step`. Both PG and SQLite (incl. D1)
          // resolve the right-hand `value` against the existing row's column.
          value: sql`${table.value} + ${step}`,
        },
      },
    );

    return Number(updated.value ?? start);
  }

  /**
   * Read the current value without advancing it. Returns `null` if the
   * `(name, scope)` pair has never been advanced.
   */
  public async peek(
    name: string,
    scope: string = "default",
  ): Promise<number | null> {
    const row = await this.repository.findOne({
      where: {
        name: { eq: name },
        scope: { eq: scope },
      } as any,
    });
    return row ? Number(row.value) : null;
  }

  /**
   * Reset the counter for `(name, scope)` to an explicit value. Creates the row
   * if it doesn't exist.
   *
   * Mostly useful in tests and ops scripts — production code should rarely call
   * this, since it can produce duplicate IDs if anything still holds a previously
   * advanced value.
   */
  public async reset(
    name: string,
    scope: string = "default",
    value: number,
  ): Promise<void> {
    await this.repository.upsert(
      { id: this.crypto.randomUUID(), name, scope, value },
      { target: ["name", "scope"], set: { value } },
    );
  }
}
