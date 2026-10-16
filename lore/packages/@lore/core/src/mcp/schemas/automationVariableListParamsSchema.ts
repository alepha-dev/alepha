import { automationVariableListQuerySchema } from "../../api/schemas/automationVariableListQuerySchema.ts";
import { projectParamsSchema } from "./projectParamsSchema.ts";

export const automationVariableListParamsSchema = projectParamsSchema
  .extend({
    ...automationVariableListQuerySchema.shape,
  })
  .strict();
