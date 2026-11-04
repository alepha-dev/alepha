import { $inject } from "alepha";
import { DatabaseCacheProvider } from "alepha/cache/database";

import {
  type MemoryPaymentBucket,
  MemoryPaymentProvider,
  type MemoryPaymentState,
} from "./MemoryPaymentProvider.ts";

/**
 * {@link MemoryPaymentProvider} whose state lives in the `cache_entries` table
 * instead of in-process Maps.
 *
 * The plain mock forgets everything between two isolates, so on Cloudflare
 * Workers a card saved at checkout may be gone when the next request reads
 * it. This one keeps every session, card, charge and refund in the
 * database (strongly consistent on D1), so a deployed QA environment can run a
 * whole paid flow with no PSP account. It is still a mock: every checkout is
 * paid and no money moves, so the application decides when to bind it.
 *
 * Needs `AlephaCacheDatabase` registered (the table). Entries expire after
 * {@link ttl}, so an abandoned QA flow does not grow the table for ever.
 *
 * The sync test helpers (`wasCharged`, `getCharges`, ...) read the in-process
 * Maps and see nothing here; assert on the database instead.
 *
 * @example
 * ```ts
 * alepha.with(AlephaCacheDatabase);
 * alepha.with({ provide: PaymentProvider, use: DatabaseMemoryPaymentProvider });
 * ```
 */
export class DatabaseMemoryPaymentProvider extends MemoryPaymentProvider {
  protected readonly cache = $inject(DatabaseCacheProvider);

  /** How long a record is kept, in milliseconds (30 days). */
  protected readonly ttl = 30 * 24 * 60 * 60 * 1000;

  protected container(bucket: MemoryPaymentBucket): string {
    return `alepha:payments:memory:${bucket}`;
  }

  protected override async read<B extends MemoryPaymentBucket>(
    bucket: B,
    key: string,
  ): Promise<MemoryPaymentState[B] | undefined> {
    return this.cache.getTyped<MemoryPaymentState[B]>(
      this.container(bucket),
      key,
    );
  }

  protected override async write<B extends MemoryPaymentBucket>(
    bucket: B,
    key: string,
    value: MemoryPaymentState[B],
  ): Promise<void> {
    await this.cache.setTyped(this.container(bucket), key, value, {
      ttl: this.ttl,
    });
  }

  protected override async remove(
    bucket: MemoryPaymentBucket,
    key: string,
  ): Promise<void> {
    await this.cache.del(this.container(bucket), key);
  }
}
