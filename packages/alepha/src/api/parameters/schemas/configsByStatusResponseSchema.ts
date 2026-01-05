import { t } from "alepha";
import { parameterResponseSchema } from "./parameterResponseSchema.ts";

/**
 * Configs by status response schema.
 */
export const configsByStatusResponseSchema = t.object({
  configs: t.array(parameterResponseSchema),
});
