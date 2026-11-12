/**
 * The options of every UPDATE a merge step builds (`updateStatement`). A
 * merge moves rows and rewrites references; it edits nothing, so:
 *
 * - `force`: soft-deleted rows move too, or they would stay behind in the
 *   source while still holding its unique keys;
 * - `touch: false`: `updated_at` drives pin and recency order, and a move
 *   is not an edit;
 * - `version: false`: a reference rewrite is no reason for a concurrent
 *   editor's save to fail;
 * - `returning: false`: a merge can rewrite many rows, and D1 caps the size
 *   of a result.
 *
 * Its DELETEs pass `force` alone (`deleteStatement` is always hard). The
 * query cache of every written table is invalidated once the batch has
 * committed.
 */
export const projectMergeWrite = {
  force: true,
  touch: false,
  version: false,
  returning: false,
} as const;
