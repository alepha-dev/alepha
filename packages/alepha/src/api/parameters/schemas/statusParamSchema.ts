import { t } from "alepha";
import { parameterStatusSchema } from "./parameterStatusSchema.ts";

/**
 * Status param schema.
 */
export const statusParamSchema = t.object({
  status: parameterStatusSchema,
});
