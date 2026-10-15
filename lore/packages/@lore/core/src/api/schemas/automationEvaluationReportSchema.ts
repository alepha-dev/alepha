import { type Infer, z } from "alepha";

import { automationActionSchema } from "./automationActionSchema.ts";
import { automationRunSnapshotSchema } from "./automationRunSnapshotSchema.ts";
import { automationSafeFieldsSchema } from "./automationSafeFieldsSchema.ts";
import { automationSourceProvenanceSchema } from "./automationSourceProvenanceSchema.ts";

export const automationEvaluationReportSchema = z
  .object({
    evaluatedAt: z.datetime(),
    preview: z.literal(true),
    status: z.enum(["preview", "refused"]),
    reason: z.string().max(1024).optional(),
    source: automationSourceProvenanceSchema.optional(),
    inputs: automationSafeFieldsSchema,
    variables: automationRunSnapshotSchema.shape.variables,
    selected: automationRunSnapshotSchema.shape.selected,
    counts: automationRunSnapshotSchema.shape.counts,
    noData: z.boolean(),
    guards: z
      .array(
        z
          .object({
            matched: z.boolean(),
            noData: z.boolean(),
            signature: z.string().max(64).optional(),
            value: z.number().optional(),
            previous: z.number().optional(),
          })
          .strict(),
      )
      .max(50),
    operations: z
      .array(
        z
          .object({
            index: z.integer().min(0).max(4),
            row: z.integer().min(0).max(49).optional(),
            action: automationActionSchema,
            rendered: automationActionSchema,
            delivery: z
              .object({
                title: z.string().max(16_384),
                text: z.string().max(16_384),
                html: z.string().max(16_384),
              })
              .strict()
              .optional(),
            bytes: z.integer().min(0).max(16_384),
            lang: z.literal("en"),
            skipped: z.boolean(),
            changed: z.boolean(),
            reason: z.string().max(1024).optional(),
            truncated: z.boolean(),
          })
          .strict(),
      )
      .max(250),
    operationsOmitted: z.integer().min(0).max(250),
    disclaimer: z.string().max(255),
  })
  .strict();
export type AutomationEvaluationReport = Infer<
  typeof automationEvaluationReportSchema
>;
