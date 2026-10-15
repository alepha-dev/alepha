import { automationPageQuerySchema } from "../../api/schemas/automationPageQuerySchema.ts";
import { projectParamsSchema } from "./projectParamsSchema.ts";

export const automationVariableListParamsSchema = projectParamsSchema
  .extend({
    ...automationPageQuerySchema.shape,
  })
  .strict();
