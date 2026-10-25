import { type Infer, z } from "alepha";

import { automationPageQuerySchema } from "./automationPageQuerySchema.ts";

export const automationVariableListQuerySchema =
  automationPageQuerySchema.extend({
    key: z.string().min(1).max(64).optional(),
  });
export type AutomationVariableListQuery = Infer<
  typeof automationVariableListQuerySchema
>;
