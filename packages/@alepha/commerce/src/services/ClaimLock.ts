import { $inject, Alepha, AlephaError } from "alepha";
import { DatabaseProvider, sql } from "alepha/orm";

/**
 * One key of the claim lock: a namespace of its own (one per ledger, so a
 * product and a resource with the same id never share a lock) and the key
 * inside it.
 */
export interface ClaimLockKey {
  namespace: string;
  key: string;
}

/**
 * Lets one claim per key decide at a time, on the databases that can hold a
 * lock, and tells the claim whether its own check is the decision.
 *
 * Shared by both inventory ledgers: `StockService` locks a product
 * (`alepha:commerce:stock`), `ResourceService` a resource
 * (`alepha:commerce:resource`). Both close the same race - two claims that
 * read the same state before either writes, both see room, both keep - and
 * both close it the same two ways:
 *
 * - **Postgres** takes `pg_advisory_xact_lock` on the key, then the claim
 *   checks and writes. The lock is held until the transaction's COMMIT (the
 *   caller's transaction, when there is one), so the next claim's check sees
 *   this one's row. `locked` is true: the check decides, exactly.
 * - **SQLite, D1 and PGlite** have a single writer and no such lock (D1 and
 *   PGlite have no interactive transaction to hold one in). `locked` is false:
 *   the claim writes first and replays second, reading every live claim back
 *   in `(createdAt, id)` order and keeping its own only if the ones before it
 *   leave room.
 *
 * Postgres cannot take the second path. `createdAt` is `now()`, the moment the
 * inserting transaction STARTED, not the moment its row became visible, so a
 * racer stamped later can replay before an earlier one has committed, count
 * too little and keep its claim while the earlier one keeps its own. No key
 * assigned before COMMIT can agree with visibility, which is why Postgres
 * locks instead of ordering.
 */
export class ClaimLock {
  protected readonly alepha = $inject(Alepha);
  protected readonly db = $inject(DatabaseProvider);

  /**
   * Whether this database holds claim locks at all. When it does not, every
   * claim replays.
   */
  public get locks(): boolean {
    return this.db.dialect === "postgresql" && this.db.supportsTransactions;
  }

  /**
   * Run one claim holding the lock on `key`, and tell it whether its check is
   * the decision.
   *
   * Two conditions come with the lock:
   *
   * - READ COMMITTED (the default) or SERIALIZABLE. REPEATABLE READ keeps the
   *   snapshot taken before the wait, so the check misses every claim that
   *   committed meanwhile and oversells; it is refused rather than trusted.
   *   SERIALIZABLE is safe but turns every contended claim into a
   *   serialization failure for the caller to retry.
   * - Locks taken in one order when a transaction claims several keys, or two
   *   of them can each hold the lock the other waits for. `OrderService` takes
   *   every key of an order up front, sorted, through {@link acquire}.
   */
  public async run<R>(
    key: ClaimLockKey,
    decide: (locked: boolean) => Promise<R>,
  ): Promise<R> {
    if (!this.locks) {
      return decide(false);
    }

    return this.db.transactional(async () => {
      await this.acquire([key]);
      return decide(true);
    });
  }

  /**
   * Take the locks on several keys, in one global order: sorted by
   * `(namespace, key)`, duplicates taken once.
   *
   * Must run inside a transaction, which the locks then outlive until COMMIT.
   * A key already held by this transaction is granted again at once, so a
   * caller that locks every key of an order up front leaves each claim's own
   * {@link run} free. A no-op on a database that holds no locks.
   */
  public async acquire(keys: ClaimLockKey[]): Promise<void> {
    if (!this.locks || keys.length === 0) {
      return;
    }

    const tx = this.alepha.get("alepha.orm.tx");
    if (!tx) {
      throw new AlephaError(
        `No transaction to hold the claim lock on ${keys[0]!.namespace}/${keys[0]!.key} in.`,
      );
    }

    for (const key of this.sorted(keys)) {
      const [row] = await tx.execute(sql`
        SELECT
          pg_advisory_xact_lock(
            hashtext(${key.namespace}),
            hashtext(${key.key})
          ),
          current_setting('transaction_isolation') AS isolation`);
      if (row?.isolation === "repeatable read") {
        throw new AlephaError(
          `${key.namespace}/${key.key} cannot be claimed under REPEATABLE READ: the transaction would check a snapshot older than the claims it waited for. Use READ COMMITTED or SERIALIZABLE.`,
        );
      }
    }
  }

  /**
   * The keys deduplicated and sorted by `(namespace, key)`: the one order
   * every transaction takes its locks in.
   */
  public sorted(keys: ClaimLockKey[]): ClaimLockKey[] {
    const unique = new Map<string, ClaimLockKey>();
    for (const key of keys) {
      unique.set(`${key.namespace}\u0000${key.key}`, key);
    }
    return [...unique.values()].sort((a, b) =>
      a.namespace !== b.namespace
        ? a.namespace < b.namespace
          ? -1
          : 1
        : a.key < b.key
          ? -1
          : a.key > b.key
            ? 1
            : 0,
    );
  }
}
