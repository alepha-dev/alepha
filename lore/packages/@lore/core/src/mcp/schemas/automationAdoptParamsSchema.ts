import { automationAdoptionBodySchema } from "../../api/schemas/automationAdoptionBodySchema.ts";
import { automationAdoptionPreviewParamsSchema } from "./automationAdoptionPreviewParamsSchema.ts";
export const automationAdoptParamsSchema = automationAdoptionPreviewParamsSchema
  .extend(automationAdoptionBodySchema.shape)
  .strict();
