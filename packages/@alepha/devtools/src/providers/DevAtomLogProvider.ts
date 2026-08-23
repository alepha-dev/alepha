import { $hook, $inject, StateManager } from "alepha";
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
 *
 * `serverOnly` atoms are never buffered: `serverOnly` is documented as a
 * security guard (its value must never reach a browser), and this buffer
 * backs the `GET /__devtools/api/atoms/log` route, served straight to the
 * devtools UI. A mutation on a raw state key with no registered atom
 * (`StateManager.getAtom()` returns `undefined`) is still logged as before -
 * only known `serverOnly` atoms are skipped.
 */
export class DevAtomLogProvider {
  protected readonly dateTime = $inject(DateTimeProvider);
  protected readonly state = $inject(StateManager);
  protected readonly maxEntries = 200;
  protected readonly buffer: AtomMutationEntry[] = [];

  protected readonly onMutate = $hook({
    on: "state:mutate",
    handler: ({ key, value, prevValue }) => {
      const atom = this.state.getAtom(String(key));
      if (atom?.options.serverOnly) {
        return;
      }

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
    // `toReversed()` copies, so neither branch hands out the live buffer
    // for a caller to mutate.
    if (key) {
      return this.buffer.filter((e) => e.key === key).toReversed();
    }
    return this.buffer.toReversed();
  }
}
