import type { Infer } from "alepha";
import { z } from "alepha";

import { adminFoldSchema } from "./adminFoldSchema.ts";

/**
 * What the admin surface publishes about one declared dataset.
 *
 * `dimensions` / `measures` are JSON Schema objects (the output of
 * `z.toJSONSchema` on the declared zod shapes), not zod schemas, this is a
 * wire format. The admin UI rebuilds form schemas from them with
 * `jsonSchemaToZod`, the same round-trip `api/parameters` already uses.
 */
export const adminDatasetSchema = z.object({
  /**
   * `dataset` for an `$analytics` dataset, `eventLog` for an `$eventLog`.
   * An event log offers its columns as dimensions and as measures, folds
   * `distinct` (and `count` on its `events` measure), groups by `week` and
   * `month` too, and is never sampled.
   */
  kind: z.enum(["dataset", "eventLog"]).optional(),
  name: z.text(),
  index: z.text(),
  dimensions: z.record(z.text(), z.any()),
  measures: z.record(z.text(), z.any()),
  /**
   * The folds each measure declares, every measure listed (`["sum"]` when it
   * declares none), so the explorer offers exactly what a query may ask.
   */
  folds: z.record(z.text(), z.array(adminFoldSchema)),
  /**
   * The finest bucket: `1m`, `5m`, `15m` or `1h`.
   */
  resolution: z.text(),
  /**
   * The retention chain, finest tier first (see `AnalyticsTiers`). The
   * original `{ hot, rollup, cold }` shape is published as the two tiers it
   * maps to, never as itself.
   */
  retention: z.array(
    z.object({ resolution: z.text(), keep: z.text().optional() }),
  ),
});

export type AdminDatasetDescriptor = Infer<typeof adminDatasetSchema>;
