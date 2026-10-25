import { $hook } from "alepha";

/**
 * Counts the SEQUENTIAL database round trips a call makes, which is what an
 * MCP tool pays on D1 (#E76, #F1362): every statement the Worker awaits costs
 * a trip to the primary, up to ~90 ms from a US colo, and statements issued
 * together in one `Promise.all` cost one trip between them.
 *
 * `ReadCounter` counts statements; this counts the longest chain of them that
 * had to wait for one another. A tool that reads five rows in parallel
 * scores 5 there and 1 here.
 *
 * ## How
 *
 * Every statement is held for `delayMs` in its `:before` event, the way D1
 * holds it on the wire. A statement that started most of `delayMs` after
 * another one started cannot have been issued alongside it: it was waiting on
 * it, or on something after it. So each statement's depth is one more than
 * the deepest statement that started that long before it, and the
 * call's trip count is the deepest depth. Statements issued together start
 * within the same few milliseconds of CPU and share a depth.
 *
 * The relational executor announces one `repository:read:before` per table
 * of a single query, sequentially and with the same `query` object; those
 * are one statement, held and counted once. Reads served from the ORM cache
 * emit nothing and are not trips, as on D1.
 *
 * ## Use
 *
 * `alepha.with(TripCounter)`, `reset()` right before the measured call, then
 * read `trips`. It slows every statement of the container by `delayMs`, so
 * only the specs that measure trips register it.
 */
export class TripCounter {
  /**
   * How long each statement is held. Larger than the CPU a tool spends
   * between issuing two parallel statements, smaller than a spec's patience.
   */
  public delayMs = 30;

  protected starts: Array<{ at: number; depth: number; table: string }> = [];
  protected seen = new WeakSet<object>();

  public get trips(): number {
    return this.starts.reduce((max, s) => Math.max(max, s.depth), 0);
  }

  public get statements(): number {
    return this.starts.length;
  }

  /**
   * The statements grouped by trip, each named by its table: what to read
   * when a count goes up.
   */
  public get chain(): string[][] {
    const out: string[][] = [];
    for (const s of this.starts) {
      if (!out[s.depth - 1]) out[s.depth - 1] = [];
      out[s.depth - 1].push(s.table);
    }
    return out;
  }

  public reset(): void {
    this.starts = [];
    this.seen = new WeakSet();
  }

  protected readonly onRead = $hook({
    on: "repository:read:before",
    handler: ({ tableName, query }) => this.hold(tableName, query),
  });

  protected readonly onCreate = $hook({
    on: "repository:create:before",
    handler: ({ tableName }) => this.hold(`create ${tableName}`, undefined),
  });

  protected readonly onUpdate = $hook({
    on: "repository:update:before",
    handler: ({ tableName }) => this.hold(`update ${tableName}`, undefined),
  });

  protected readonly onDelete = $hook({
    on: "repository:delete:before",
    handler: ({ tableName }) => this.hold(`delete ${tableName}`, undefined),
  });

  protected async hold(table: string, query: unknown): Promise<void> {
    if (query && typeof query === "object") {
      if (this.seen.has(query)) return;
      this.seen.add(query);
    }
    // Real time, on purpose: the measurement is of real waiting, and a spec
    // that pauses `DateTimeProvider` must not freeze it.
    const at = performance.now();
    // Two thirds of the hold, not all of it: a timer may fire a fraction of
    // a millisecond before `performance.now()` says it is due, and a
    // statement issued alongside another starts well inside a third of it.
    const after = (this.delayMs * 2) / 3;
    let depth = 1;
    for (const s of this.starts) {
      if (s.at + after <= at) depth = Math.max(depth, s.depth + 1);
    }
    this.starts.push({ at, depth, table });
    await new Promise((resolve) => setTimeout(resolve, this.delayMs));
  }
}
