import { type Infer, z } from "alepha";

import { automationActionSchema } from "./automationActionSchema.ts";
import { automationGuardSchema } from "./automationGuardSchema.ts";
import { automationSelectionSchema } from "./automationSelectionSchema.ts";
import { automationTriggerSchema } from "./automationTriggerSchema.ts";

export const automationRuleSchema = z
  .object({
    version: z.literal(1),
    trigger: automationTriggerSchema,
    select: automationSelectionSchema.nullable(),
    guard: automationGuardSchema.nullable(),
    actions: z.array(automationActionSchema).min(1).max(5),
  })
  .strict()
  .refine(
    (rule) =>
      rule.trigger.kind === "event"
        ? rule.select === null
        : rule.select !== null,
    {
      message:
        "Events require select=null; schedules require a registered selection",
    },
  );

export type AutomationRule = Infer<typeof automationRuleSchema>;
