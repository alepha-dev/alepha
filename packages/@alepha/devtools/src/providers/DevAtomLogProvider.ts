import { $hook, $inject } from "alepha";
import { DateTimeProvider } from "alepha/datetime";

export interface AtomMutationEntry {
  key: string;
  value: unknown;
  prevValue: unknown;
  at: number;
}

/**
 * In-memory ring buffer of `state:mutate` events, powering the devtools
 * "Recent mutations" panel. Dev-only, capped at 200 entries.
 */
export class DevAtomLogProvider {
  protected readonly dateTime = $inject(DateTimeProvider);
  protected readonly maxEntries = 200;
  protected readonly buffer: AtomMutationEntry[] = [];

  protected readonly onMutate = $hook({
    on: "state:mutate",
    handler: ({ key, value, prevValue }) => {
      this.buffer.push({
        key: String(key),
        value,
        prevValue,
        at: this.dateTime.nowMillis(),
      });
      if (this.buffer.length > this.maxEntries) {
        this.buffer.shift();
      }
    },
  });

  /**
   * Entries, newest first, optionally filtered by state key.
   */
  public entries(key?: string): AtomMutationEntry[] {
    const list = key ? this.buffer.filter((e) => e.key === key) : this.buffer;
    return [...list].reverse();
  }
}
