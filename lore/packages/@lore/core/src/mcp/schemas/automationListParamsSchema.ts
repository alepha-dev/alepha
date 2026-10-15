import { automationListQuerySchema } from "../../api/schemas/automationListQuerySchema.ts";
import { projectParamsSchema } from "./projectParamsSchema.ts";

export const automationListParamsSchema = projectParamsSchema
  .extend({
    ...automationListQuerySchema.shape,
  })
  .strict();
