import { type Infer, z } from "alepha";

import { estateInventoryAppSchema } from "./estateInventoryAppSchema.ts";
import { estateInventoryHostSchema } from "./estateInventoryHostSchema.ts";

/**
 * Which of the three states an instance is in, once what the machine reports
 * is held against what Lore tracks.
 *
 * ⚠️ A text enum, so it is never an `ORDER BY`. Lore's board sorted a priority
 * enum in SQL for its whole life and showed `optional` above `high`; the
 * order this wants (matched, then machine-only, then Lore-only) is a
 * comparator over the array in memory.
 */
export const ESTATE_INVENTORY_APP_STATES = [
  "matched",
  "untracked",
  "missing",
] as const;

export type EstateInventoryAppState =
  (typeof ESTATE_INVENTORY_APP_STATES)[number];

/**
 * The project an instance belongs to, as the console names it: enough to
 * link there and nothing of what is inside it. The shape `estateLoanSchema`
 * already uses, for the same reason.
 */
export const estateInventoryProjectSchema = z.object({
  id: z.integer(),
  title: z.string(),
  slug: z.string().optional(),
});

export type EstateInventoryProject = Infer<typeof estateInventoryProjectSchema>;

/**
 * One instance the machine reported, stamped with what Lore knows about it.
 *
 * `matched` carries the instance and its project, so the row links through to
 * the project's app page. `untracked` is running on the machine and tracked
 * nowhere in Lore, which is a fact worth showing rather than hiding.
 */
export const estateInventoryReportedAppSchema = estateInventoryAppSchema.extend(
  {
    state: z.enum(["matched", "untracked"]),
    instanceId: z.uuid().optional(),
    project: estateInventoryProjectSchema.optional(),
  },
);

export type EstateInventoryReportedApp = Infer<
  typeof estateInventoryReportedAppSchema
>;

/**
 * An instance Lore tracks against this estate that the machine did NOT
 * report: "expected here, not running".
 *
 * The state that catches a failed deploy, and the reason the reconciliation
 * earns its keep. The machine reports `(app, env)` and knows nothing about
 * projects; only this side can notice something is missing.
 */
export const estateInventoryExpectedAppSchema = z.object({
  app: z.string().max(100),
  env: z.string().max(100),
  instanceId: z.uuid(),
  project: estateInventoryProjectSchema.optional(),
  state: z.literal("missing"),
});

export type EstateInventoryExpectedApp = Infer<
  typeof estateInventoryExpectedAppSchema
>;

/**
 * What the console reads: the stored snapshot, reconciled, plus what Lore
 * expected here and did not get.
 *
 * ⚠️ `inventory` is nullable rather than absent-or-404. A machine that has
 * never connected has no row, and that is an answer the page renders
 * ("nothing reported yet") beside the `expected` list, which is still worth
 * showing. Only the estate itself 404s, through `loadOwned`.
 *
 * Every string on the way out is bounded by the frame schemas this reuses,
 * so `problems[]` items and `lastBackupError` carry their caps here without
 * being restated: a response field with no length is how a blank screen
 * happens.
 */
export const estateInventoryResourceSchema = z.object({
  inventory: z
    .object({
      at: z.string().max(40),
      reportedAt: z.string().max(40),
      bayVersion: z.string().max(100).optional(),
      host: estateInventoryHostSchema,
      apps: z.array(estateInventoryReportedAppSchema),
    })
    .nullable(),
  expected: z.array(estateInventoryExpectedAppSchema),
});

export type EstateInventoryResource = Infer<
  typeof estateInventoryResourceSchema
>;
