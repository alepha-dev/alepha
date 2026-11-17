import { type Infer, z } from "alepha";

import { automationGraphNodeIdSchema } from "./automationGraphNodeIdSchema.ts";
import { automationGraphSchema } from "./automationGraphSchema.ts";
import { automationSafeFieldsSchema } from "./automationSafeFieldsSchema.ts";
import { automationSelectionCursorSchema } from "./automationSelectionCursorSchema.ts";
import { automationSourceProvenanceSchema } from "./automationSourceProvenanceSchema.ts";
import { automationVariableValueSchema } from "./automationVariableValueSchema.ts";

/**
 * Sanitization happens before validation. The persisted envelope has a byte cap
 * as well as structural limits, including when multibyte text is used.
 */
export const automationRunSnapshotSchema = z
  .object({
    /**
     * What the run can walk (#Q3804): its source and the nodes that source
     * reaches, positions stripped. A health record holds the whole graph.
     */
    rule: automationGraphSchema.nullable(),
    /**
     * The source node the run started at; absent on a health record.
     */
    sourceNode: automationGraphNodeIdSchema.optional(),
    ruleHash: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
    omitted: z.string().max(255).optional(),
    evaluatedAt: z.datetime().optional(),
    health: z
      .object({
        from: z.enum(["active", "paused", "broken"]),
        to: z.enum(["active", "paused", "broken"]),
      })
      .strict()
      .optional(),
    source: automationSourceProvenanceSchema.optional(),
    selectionNext: automationSelectionCursorSchema.optional(),
    noData: z.boolean().optional(),
    inputs: automationSafeFieldsSchema,
    variables: z
      .array(
        z
          .object({
            id: z.uuid().optional(),
            key: z.string().max(64),
            version: z.integer().nonnegative(),
            value: automationVariableValueSchema,
          })
          .strict(),
      )
      .max(64),
    selected: z.array(automationSafeFieldsSchema).max(50),
    counts: z
      .object({
        selected: z.integer().min(0).max(50),
        matched: z.integer().min(0).max(50),
        executed: z.integer().min(0).max(250),
        deliveries: z.integer().min(0).max(100),
        skipped: z.integer().nonnegative(),
        total: z.integer().nonnegative(),
        totalIsExact: z.boolean(),
        truncated: z.boolean(),
        hasMore: z.boolean(),
      })
      .strict(),
    /**
     * Every condition decided at plan time, per row: the port it took, or
     * none when it had no data. The nodes behind an untaken port were
     * skipped by it.
     */
    conditions: z
      .array(
        z
          .object({
            node: automationGraphNodeIdSchema,
            row: z.integer().min(0).max(49).optional(),
            port: z.enum(["true", "false"]).optional(),
          })
          .strict(),
      )
      .max(250)
      .optional(),
    /**
     * The planned steps, in walk order: one per action node reached, per
     * channel of a notification, per row.
     */
    actions: z
      .array(
        z
          .object({
            node: automationGraphNodeIdSchema,
            channel: z.string().max(255).optional(),
            row: z.integer().min(0).max(49).optional(),
            status: z.enum([
              "pending",
              "running",
              "succeeded",
              "skipped",
              "refused",
              "failed",
              "unknown",
              "queued",
              "not_reached",
            ]),
            /**
             * The failed or refused node that stopped this step's branch.
             */
            after: automationGraphNodeIdSchema.optional(),
            result: automationSafeFieldsSchema,
            receiptId: z.string().max(255).optional(),
          })
          .strict(),
      )
      .max(250),
  })
  .strict()
  .refine(
    (value) => value.rule !== null || (!!value.ruleHash && !!value.omitted),
    {
      message: "An omitted rule requires its hash and an explicit reason",
    },
  )
  .refine(
    (value) =>
      new TextEncoder().encode(JSON.stringify(value)).byteLength <= 65_536,
    {
      message: "Automation snapshot exceeds 64 KiB",
    },
  );

export type AutomationRunSnapshot = Infer<typeof automationRunSnapshotSchema>;
