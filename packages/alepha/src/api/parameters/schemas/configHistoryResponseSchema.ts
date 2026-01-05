import { t } from "alepha";
import { parameterResponseSchema } from "./parameterResponseSchema.ts";

/**
 * Config history response schema.
 */
export const configHistoryResponseSchema = t.object({
  versions: t.array(parameterResponseSchema),
});
