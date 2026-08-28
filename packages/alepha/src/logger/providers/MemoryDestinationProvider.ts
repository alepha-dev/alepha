import type { LogEntry } from "../schemas/logEntrySchema.ts";
import { LogDestinationProvider } from "./LogDestinationProvider.ts";

/**
 * An entry as the memory buffer holds it: the entry itself, the line the
 * formatter produced, and the buffer position.
 */
export type MemoryLogEntry = LogEntry & { formatted: string; seq: number };

export class MemoryDestinationProvider extends LogDestinationProvider {
  protected entries: MemoryLogEntry[] = [];

  /**
   * The next sequence number to hand out.
   *
   * Monotonic for the life of the process and never reused, `clear()`
   * included. A reader tailing this buffer keeps the last sequence it saw as
   * its cursor, so reusing a number would make an entry it has already read
   * look new, and resetting on clear would make everything logged afterwards
   * look old.
   *
   * The timestamp cannot play this role. A millisecond routinely holds dozens
   * of entries, and a cursor with millisecond resolution can only ever be
   * "everything at or after T" (which re-delivers) or "everything after T"
   * (which drops the rest of that millisecond). The devtools tail chose the
   * second and lost them.
   */
  protected nextSeq = 0;

  /**
   * How many entries the ring has evicted, ever.
   *
   * Lets a reader tell "nothing new" from "you missed some" - the difference
   * between a quiet buffer and one that overflowed while it was catching up.
   */
  protected evicted = 0;

  public readonly options = {
    maxEntries: 10_000,
  };

  public write(formatted: string, entry: LogEntry): void {
    this.entries.push({ ...entry, formatted, seq: this.nextSeq++ });

    if (this.entries.length > this.options.maxEntries) {
      const keep = Math.floor(this.options.maxEntries * 0.8);
      this.evicted += this.entries.length - keep;
      this.entries = this.entries.slice(-keep);
    }
  }

  public get logs() {
    return [...this.entries];
  }

  /**
   * Entries lost to the ring.
   *
   * `clear()` is deliberately not counted: emptying the buffer is something a
   * person asked for, and reporting it as loss would raise a "you missed some"
   * marker the instant they pressed the button that emptied the view.
   */
  public get dropped(): number {
    return this.evicted;
  }

  public clear(): void {
    this.entries = [];
  }
}
