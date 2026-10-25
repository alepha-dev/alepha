/**
 * Splits a list of ids into batches small enough to bind as query parameters.
 *
 * Every value in an `inArray` is one bound parameter, and a statement that
 * exceeds the driver's ceiling fails outright. Lore runs on Cloudflare D1,
 * whose ceiling is **100** - probed on `lore-production`: 100 placeholders
 * run, 101 fail with `too many SQL variables at offset 266: SQLITE_ERROR`.
 * That is low enough to be crossed by ordinary growth rather than by abuse:
 * the feedback list started 500ing the day project 1's accepted feedback
 * carried its 101st attachment, having worked for months.
 *
 * So an unbounded `inArray` over a list that grows with the data is a cliff,
 * not a round-trip optimisation. Anything bounded by a page size (the 50 rows
 * of one listing) is fine as it is; anything bounded by what the rows happen
 * to contain goes through here.
 *
 * The bound is deliberately under D1's 100 rather than at it, because a
 * statement binds more than its `inArray`: the repository adds its own
 * predicates (soft delete, tenancy) and the caller usually adds a filter or
 * two of their own.
 */
export class BoundParameters {
  /**
   * Values per statement. 90, matching `BlightJobs.PURGE_BATCH_SIZE`, which
   * arrived at the same number for the same reason.
   */
  readonly limit = 90;

  /**
   * Split ids into batches of at most {@link BoundParameters.limit}.
   *
   * An empty input gives no batches at all rather than one empty batch, which
   * is what callers want: `inArray: []` throws.
   */
  chunk<T>(ids: readonly T[]): T[][] {
    const batches: T[][] = [];
    for (let i = 0; i < ids.length; i += this.limit) {
      batches.push(ids.slice(i, i + this.limit));
    }
    return batches;
  }

  /**
   * Run `read` once per batch and concatenate the rows.
   *
   * Sequential rather than parallel on purpose: these run inside a Worker
   * request, where a fan-out of D1 statements buys latency at the cost of
   * subrequest budget, and the lists this covers are one or two batches in
   * practice.
   */
  async collect<T, R>(
    ids: readonly T[],
    read: (batch: T[]) => Promise<R[]>,
  ): Promise<R[]> {
    const rows: R[] = [];
    for (const batch of this.chunk(ids)) {
      rows.push(...(await read(batch)));
    }
    return rows;
  }
}
