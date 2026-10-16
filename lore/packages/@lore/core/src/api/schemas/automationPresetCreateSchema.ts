import { type Infer, z } from "alepha";

import { automationFilterValueSchema } from "./automationFilterValueSchema.ts";
import { automationVariableApprovalSchema } from "./automationVariableApprovalSchema.ts";

export const automationPresetCreateSchema = z
  .object({
    key: z.string().min(1).max(128),
    title: z.string().min(1).max(255).optional(),
    bindings: z
      .record(z.string().max(64), automationVariableApprovalSchema)
      .refine((value) => Object.keys(value).length <= 16)
      .optional(),
    values: z
      .record(z.string().max(64), automationFilterValueSchema)
      .refine((values) => Object.keys(values).length <= 16),
  })
  .strict();
export type AutomationPresetCreate = Infer<typeof automationPresetCreateSchema>;
