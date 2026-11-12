/**
 * The reads one board resolution shares between its metrics (#Q3490).
 *
 * Several tiles are drawn from the same report: Burn-up, Completed per week,
 * Completed this week and Board columns all read `completedByDay`, and each
 * read scans every quest of the project. `DashboardMetricRegistry` makes one
 * share per resolution and hands it to every resolver on its entries, so the
 * second tile asking for a read gets the first one's promise instead of a
 * second scan.
 *
 * ## Why one resolution, never longer
 *
 * The share lives as long as one `resolveOn` call and holds nothing across
 * requests. A board is read at one moment, so two tiles agreeing on that
 * moment's rows is what they should do anyway; a share that outlived the
 * request would show a quest completed a second ago as still open.
 *
 * ## The key
 *
 * The caller names the read and everything that changes its answer
 * (`completedByDay:12` for one project at the fixed query). Two reads with
 * the same key MUST return the same thing: the share cannot check it.
 */
export class DashboardReadShare {
  protected readonly reads = new Map<string, Promise<unknown>>();

  /**
   * `read()` the first time `key` is asked for, and the same promise every
   * time after. A rejection is shared too: the tiles that asked fail together,
   * as they would have each failed on their own.
   */
  once<T>(key: string, read: () => Promise<T>): Promise<T> {
    let pending = this.reads.get(key) as Promise<T> | undefined;
    if (!pending) {
      pending = read();
      this.reads.set(key, pending);
    }
    return pending;
  }
}
