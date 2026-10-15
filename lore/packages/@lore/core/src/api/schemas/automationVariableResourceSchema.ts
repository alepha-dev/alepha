import { type Infer, z } from "alepha";

import { automationVariableValueSchema } from "./automationVariableValueSchema.ts";

export const automationVariableResourceSchema = z
  .object({
    id: z.uuid(),
    key: z.string().max(64),
    version: z.integer().nonnegative(),
    kind: automationVariableValueSchema.shape.kind,
    value: automationVariableValueSchema.nullable(),
    available: z.boolean(),
    reason: z.string().max(1024).optional(),
  })
  .strict();
export type AutomationVariableResource = Infer<
  typeof automationVariableResourceSchema
>;
