import { type Infer, z } from "alepha";

import { automationRuleSchema } from "./automationRuleSchema.ts";
import { automationSafeFieldsSchema } from "./automationSafeFieldsSchema.ts";
import { automationVariableValueSchema } from "./automationVariableValueSchema.ts";

/**
 * Sanitization happens before validation. The persisted envelope has a byte cap
 * as well as structural limits, including when multibyte text is used.
 */
export const automationRunSnapshotSchema = z
  .object({
    rule: automationRuleSchema,
    inputs: automationSafeFieldsSchema,
    variables: z
      .array(
        z
          .object({
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
    actions: z
      .array(
        z
          .object({
            index: z.integer().min(0).max(4),
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
            ]),
            result: automationSafeFieldsSchema,
            receiptId: z.string().max(255).optional(),
          })
          .strict(),
      )
      .max(250),
  })
  .strict()
  .refine(
    (value) =>
      new TextEncoder().encode(JSON.stringify(value)).byteLength <= 65_536,
    {
      message: "Automation snapshot exceeds 64 KiB",
    },
  );

export type AutomationRunSnapshot = Infer<typeof automationRunSnapshotSchema>;
