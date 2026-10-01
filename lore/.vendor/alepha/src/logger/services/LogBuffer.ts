import type { LogEntry } from "../schemas/logEntrySchema.ts";

/**
 * Bounded ring of log entries scoped to one execution context (an HTTP
 * request, a job run, a CLI command).
 *
 * The buffer carries its own limit so that {@link Logger} can push into it
 * without reading any configuration on the hot path: whoever seeds the buffer
 * decides how much it retains.
 *
 * The **last** entries are kept, not the first — the lines adjacent to a
 * failure are the ones that explain it.
 */
export class LogBuffer {
  /**
   * Key under which the active buffer lives in the ALS store.
   *
   * Seeded by {@link LogBufferProvider.seed} at the entry point of an
   * execution context; absent everywhere else, which is what makes the
   * capture free when it is not wanted.
   */
  public static readonly key = "alepha.logs";

  protected readonly entries: LogEntry[] = [];
  protected readonly max: number;
  protected dropped = 0;

  constructor(max: number) {
    this.max = max;
  }

  public get size(): number {
    return this.entries.length;
  }

  public push(entry: LogEntry): void {
    this.entries.push(entry);
    if (this.entries.length > this.max) {
      this.entries.shift();
      this.dropped++;
    }
  }

  /**
   * A new array each time, so a consumer holding a snapshot is unaffected by
   * entries arriving afterwards. The entries themselves are shared, not cloned
   * — the same objects already reach every formatter, destination and `log`
   * event listener, and treating this one path as if it owned them would cost
   * a deep copy per error report while protecting nothing.
   *
   * A truncated buffer says so, in band. A silent cap reads as "this is
   * everything that happened", which is how you spend an afternoon looking for
   * a cause that was discarded. The synthetic entry borrows the timestamp of
   * the oldest surviving entry rather than reading a clock, so the buffer needs
   * no collaborators.
   */
  public snapshot(): LogEntry[] {
    if (this.dropped === 0) {
      return [...this.entries];
    }

    return [
      {
        level: "WARN",
        message: `${this.dropped} earlier entries dropped (buffer size ${this.max})`,
        service: "alepha.logger",
        module: "alepha.logger",
        timestamp: this.entries[0].timestamp,
      },
      ...this.entries,
    ];
  }
}
