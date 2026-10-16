import { automationAdoptionPolicySchema } from "../../api/schemas/automationAdoptionPolicySchema.ts";
import { projectParamsSchema } from "./projectParamsSchema.ts";
export const automationAdoptionPreviewParamsSchema = projectParamsSchema
  .extend({ policy: automationAdoptionPolicySchema })
  .strict();
