import type { Infer } from "alepha";
import { z } from "alepha";

/**
 * A fold as the admin surface offers it: a dataset's own (`sum`, `min`,
 * `max`, `last`), and an event log's `distinct` and `count` besides. Which
 * one a measure allows is its descriptor's `folds`, checked on every query.
 */
export const adminFoldSchema = z.enum([
  "sum",
  "min",
  "max",
  "last",
  "distinct",
  "count",
]);

export type AdminFold = Infer<typeof adminFoldSchema>;
