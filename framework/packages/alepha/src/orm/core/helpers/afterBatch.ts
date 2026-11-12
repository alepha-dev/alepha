import type { SQL } from "drizzle-orm";

/**
 * What a statement built by a repository does once the batch carrying it has
 * committed: invalidate the query cache, emit the `repository:*:after` event.
 * It receives the statement's own rows.
 */
export type AfterBatch = (rows: Record<string, unknown>[]) => Promise<void>;

const AFTER_BATCH = Symbol.for("alepha.orm.afterBatch");

/**
 * Attach `hook` to a statement, for `DatabaseProvider.atomicBatch` to run
 * after the commit. The statement itself is unchanged.
 */
export const withAfterBatch = (statement: SQL, hook: AfterBatch): SQL => {
  Object.defineProperty(statement, AFTER_BATCH, { value: hook });
  return statement;
};

/**
 * The hook a statement carries, if a repository built it.
 */
export const afterBatchOf = (statement: unknown): AfterBatch | undefined =>
  statement && typeof statement === "object"
    ? (statement as { [AFTER_BATCH]?: AfterBatch })[AFTER_BATCH]
    : undefined;
