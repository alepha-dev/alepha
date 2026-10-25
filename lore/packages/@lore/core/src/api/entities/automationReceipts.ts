import { type Infer, z } from "alepha";
import { $entity, db, sql } from "alepha/orm";

import { automationRunSnapshotSchema } from "../schemas/automationRunSnapshotSchema.ts";
import { automationSafeFieldsSchema } from "../schemas/automationSafeFieldsSchema.ts";
import { automations } from "./automations.ts";
import { projects } from "./projects.ts";

/**
 * Run IDs intentionally have no FK: 30-day detail pruning must never remove
 * 90-day occurrence or effect receipts. Recipient pages are separate rows,
 * never an unbounded roster JSON value in a run snapshot.
 */
export const automationReceipts = $entity({
  name: "automation_receipts",
  schema: z.object({
    id: db.primaryKey(z.string().min(1).max(255)),
    version: db.version(),
    projectId: db.ref(z.integer(), () => projects.cols.id, {
      onDelete: "cascade",
    }),
    automationId: db.ref(z.uuid().optional(), () => automations.cols.id, {
      onDelete: "restrict",
    }),
    identity: z.string().min(1).max(255),
    kind: z
      .enum([
        "occurrence",
        "action",
        "recipient",
        "roster",
        "chunk",
        "guard",
        "job_origin",
        "legacy",
      ])
      .meta({ mode: "text" }),
    status: z
      .enum([
        "ready",
        "claimed",
        "committed",
        "skipped",
        "refused",
        "failed",
        "unknown",
      ])
      .meta({ mode: "text" }),
    occurrenceId: z.string().min(1).max(255),
    ruleRevision: z.integer().nonnegative(),
    occurredAt: z.datetime(),
    replayUntil: z.datetime(),
    leaseToken: z.uuid().optional(),
    leaseUntil: z.datetime().optional(),
    parentId: z.string().max(255).optional(),
    runId: z.uuid().optional(),
    inputHash: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
    mode: z.enum(["atomic", "external"]).meta({ mode: "text" }).optional(),
    snapshot: automationRunSnapshotSchema.optional(),
    result: automationSafeFieldsSchema.optional(),
    recipientUserId: z.uuid().optional(),
    recipientChannel: z.string().max(32).optional(),
    position: z.integer().nonnegative().optional(),
    actionIndex: z.integer().min(0).max(4).optional(),
    rowIndex: z.integer().min(0).max(49).optional(),
    deliveryKey: z.string().max(255).optional(),
    cursor: db.default(z.integer().nonnegative(), 0),
    queueAttempts: db.default(z.integer().nonnegative(), 0),
    rosterComplete: db.default(z.boolean(), false),
    reason: z.string().max(1024).optional(),
    createdAt: db.createdAt(),
    updatedAt: db.updatedAt(),
  }),
  constraints: [
    {
      name: "automation_receipts_valid_id",
      columns: ["id"],
      check: sql`id IS NOT NULL`,
    },
  ],
  indexes: [
    {
      name: "automation_receipts_rule_state_idx",
      columns: ["automationId", "kind", "status"],
    },
    { columns: ["projectId", "identity"], unique: true },
    {
      name: "automation_receipts_running_rule",
      columns: ["automationId"],
      unique: true,
      where: sql`kind = 'occurrence' AND status = 'claimed'`,
    },
    { columns: ["kind", "status", "leaseUntil", "id"] },
    { columns: ["parentId", "kind", "position"] },
    { columns: ["kind", "status", "queueAttempts", "createdAt", "id"] },
    { columns: ["projectId", "kind", "createdAt", "id"] },
    { columns: ["replayUntil", "status", "id"] },
  ],
});

export type AutomationReceipt = Infer<typeof automationReceipts.schema>;
