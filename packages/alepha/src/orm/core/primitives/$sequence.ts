import { $inject, createPrimitive, KIND, Primitive } from "alepha";

import { SequenceProvider } from "../providers/SequenceProvider.ts";

/**
 * Declare a portable, scoped numeric sequence.
 *
 * Works identically on Postgres, SQLite, and Cloudflare D1 - backed by the
 * shared `alepha_sequences` table managed by {@link SequenceProvider}.
 *
 * @example
 * ```ts
 * class Quests {
 *   // Sequence name defaults to the property key - here "shortId".
 *   shortId = $sequence();
 *
 *   async create(campaignId: number, data: ...) {
 *     // Global counter - same primitive, one shared "default" scope.
 *     const n = await this.shortId.next();
 *
 *     // Scoped counter - one independent sequence per campaign.
 *     const perCampaign = await this.shortId.next(String(campaignId));
 *   }
 * }
 * ```
 *
 * @see {@link SequenceProvider}
 */
export const $sequence = (
  options: SequencePrimitiveOptions = {},
): SequencePrimitive => {
  return createPrimitive(SequencePrimitive, options);
};

// ---------------------------------------------------------------------------------------------------------------------

export interface SequencePrimitiveOptions {
  /**
   * Sequence name. Defaults to the primitive's property key. Two primitives
   * sharing the same name share the same counter table rows, which is rarely
   * what you want — prefer letting the property key drive the name.
   */
  name?: string;

  /**
   * Starting value used on the very first `.next()` for a `(name, scope)` pair.
   * Defaults to `1`.
   */
  startWith?: number;

  /**
   * Amount added on every call to `.next()`. Defaults to `1`.
   */
  incrementBy?: number;
}

// ---------------------------------------------------------------------------------------------------------------------

export class SequencePrimitive extends Primitive<SequencePrimitiveOptions> {
  protected readonly provider = $inject(SequenceProvider);

  public get name(): string {
    return this.options.name ?? this.config.propertyKey;
  }

  /**
   * Atomically advance the counter and return the new value.
   *
   * Scope defaults to "default". Pass any string to keep an independent counter
   * per tenant / campaign / parent entity / etc.
   *
   * **Transaction semantics:** the increment is one atomic statement. Inside a
   * real `$transactional` block it participates in that transaction, so a
   * rollback unwinds it and a failed insert returns its value to the pool.
   * Without one (Cloudflare D1, where `$transactional` is a no-op) nothing
   * unwinds it: a failed insert burns its value and leaves a gap, never a
   * duplicate.
   */
  public async next(scope: string = "default"): Promise<number> {
    return this.provider.advance(this.name, scope, {
      startWith: this.options.startWith,
      incrementBy: this.options.incrementBy,
    });
  }

  /**
   * Read the current value without advancing it. Returns `null` if the
   * `(name, scope)` pair has never been advanced.
   */
  public async current(scope: string = "default"): Promise<number | null> {
    return this.provider.peek(this.name, scope);
  }

  /**
   * Reset the counter for the given scope to an explicit value. Creates the row
   * if it doesn't exist. Mostly useful in tests and ops scripts.
   */
  public async reset(value: number, scope: string = "default"): Promise<void> {
    return this.provider.reset(this.name, scope, value);
  }
}

$sequence[KIND] = SequencePrimitive;
