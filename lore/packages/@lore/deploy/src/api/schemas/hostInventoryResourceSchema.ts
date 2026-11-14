import { type Infer, z } from "alepha";

import { hostInventoryAppSchema } from "./hostInventoryAppSchema.ts";
import { hostInventoryMachineSchema } from "./hostInventoryMachineSchema.ts";
import { hostInventoryStackSchema } from "./hostInventoryStackSchema.ts";

/**
 * Which of the three states an instance is in, once what the machine reports
 * is held against what Lore tracks.
 *
 * ⚠️ **Called `tracking`, never `state`, on the rows that carry it.** The
 * machine already reports a `state` - systemd's `ActiveState` - and the two
 * answer different questions: one is what Lore knows about the instance, the
 * other is what the process is doing. Naming both `state` makes the extend
 * silently overwrite the machine's, which is a whole column of truth
 * disappearing without an error.
 *
 * ⚠️ A text enum, so it is never an `ORDER BY`. Lore's board sorted a priority
 * enum in SQL for its whole life and showed `optional` above `high`; the
 * order this wants (matched, then machine-only, then Lore-only) is a
 * comparator over the array in memory.
 */
const HOST_INVENTORY_TRACKING = ["matched", "untracked", "missing"] as const;

export type HostInventoryTracking = (typeof HOST_INVENTORY_TRACKING)[number];

/**
 * The project an instance belongs to, as the console names it: enough to
 * link there and nothing of what is inside it. The shape `hostLoanSchema`
 * already uses, for the same reason.
 */
export const hostInventoryProjectSchema = z.object({
  id: z.integer(),
  title: z.string(),
  slug: z.string().optional(),
});

export type HostInventoryProject = Infer<typeof hostInventoryProjectSchema>;

/**
 * One instance the machine reported, stamped with what Lore knows about it.
 *
 * `matched` carries the instance and its project, so the row links through to
 * the project's app page. `untracked` is running on the machine and tracked
 * nowhere in Lore, which is a fact worth showing rather than hiding.
 */
export const hostInventoryReportedAppSchema = hostInventoryAppSchema.extend({
  tracking: z.enum(["matched", "untracked"]),
  instanceId: z.uuid().optional(),
  project: hostInventoryProjectSchema.optional(),
});

export type HostInventoryReportedApp = Infer<
  typeof hostInventoryReportedAppSchema
>;

/**
 * An instance Lore tracks against this host that the machine did NOT
 * report: "expected here, not running".
 *
 * The state that catches a failed deploy, and the reason the reconciliation
 * earns its keep. The machine reports `(app, env)` and knows nothing about
 * projects; only this side can notice something is missing.
 */
export const hostInventoryExpectedAppSchema = z.object({
  app: z.string().max(100),
  env: z.string().max(100),
  instanceId: z.uuid(),
  project: hostInventoryProjectSchema.optional(),
  tracking: z.literal("missing"),
});

export type HostInventoryExpectedApp = Infer<
  typeof hostInventoryExpectedAppSchema
>;

/**
 * What the console reads: the stored snapshot, reconciled, plus what Lore
 * expected here and did not get.
 *
 * ⚠️ `inventory` is nullable rather than absent-or-404. A machine that has
 * never connected has no row, and that is an answer the page renders
 * ("nothing reported yet") beside the `expected` list, which is still worth
 * showing. Only the host itself is refused, by its home project's gate.
 *
 * Every string on the way out is bounded by the frame schemas this reuses,
 * so `problems[]` items and `lastBackupError` carry their caps here without
 * being restated: a response field with no length is how a blank screen
 * happens.
 */
export const hostInventoryResourceSchema = z.object({
  inventory: z
    .object({
      at: z.string().max(40),
      reportedAt: z.string().max(40),
      bayVersion: z.string().max(100).optional(),
      machine: hostInventoryMachineSchema,
      apps: z.array(hostInventoryReportedAppSchema),
      stacks: z.array(hostInventoryStackSchema).optional(),
    })
    .nullable(),
  expected: z.array(hostInventoryExpectedAppSchema),
});

export type HostInventoryResource = Infer<typeof hostInventoryResourceSchema>;
