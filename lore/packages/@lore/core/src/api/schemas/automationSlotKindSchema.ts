import { type Infer, z } from "alepha";

import { automationVariableValueSchema } from "./automationVariableValueSchema.ts";

export const automationSlotKindSchema = z.enum([
  ...automationVariableValueSchema.shape.kind.options,
  "boolean",
  "textArray",
]);
export type AutomationSlotKind = Infer<typeof automationSlotKindSchema>;
