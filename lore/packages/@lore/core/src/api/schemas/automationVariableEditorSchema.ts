import { z } from "alepha";

import { automationVariableValueSchema } from "./automationVariableValueSchema.ts";

export const automationVariableEditorSchema = z.object({
  key: z.string().min(1).max(64),
  kind: automationVariableValueSchema.shape.kind,
});
