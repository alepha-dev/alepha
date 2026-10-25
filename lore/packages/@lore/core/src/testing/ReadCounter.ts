import { $hook } from "alepha";

/**
 * Counts reads that actually reach the database, per table.
 *
 * `repository:read:before` fires **after** the ORM's cache check, so a read
 * served from a TTL cache is not counted - which is what makes this a query
 * counter and not a call counter. Every read path announces itself on it:
 * `findMany`, the relational executor, `count` and `aggregate` alike. That
 * last pair matters here, because the shape these specs exist to catch is
 * one query per row of a page, and the row-wise form is usually a count.
 *
 * Register it on the container under test (`alepha.with(ReadCounter)`) and
 * `reset()` immediately before the call being measured - fixtures read too.
 */
export class ReadCounter {
  public readonly byTable = new Map<string, number>();

  protected readonly onRead = $hook({
    on: "repository:read:before",
    handler: ({ tableName }) => {
      this.byTable.set(tableName, (this.byTable.get(tableName) ?? 0) + 1);
    },
  });

  public reset(): void {
    this.byTable.clear();
  }

  public of(tableName: string): number {
    return this.byTable.get(tableName) ?? 0;
  }
}
