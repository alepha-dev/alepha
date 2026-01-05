import { t } from "alepha";
import { parameterResponseSchema } from "./parameterResponseSchema.ts";

/**
 * Config version response schema.
 */
export const configVersionResponseSchema = t.object({
  config: t.optional(parameterResponseSchema),
});
