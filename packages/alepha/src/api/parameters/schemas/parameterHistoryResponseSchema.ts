import { type Static, t } from "alepha";
import { parameterResponseSchema } from "./parameterResponseSchema.ts";

/**
 * Parameter history response schema.
 */
export const parameterHistoryResponseSchema = t.object({
  versions: t.array(parameterResponseSchema),
});

export type ParameterHistoryResponse = Static<
  typeof parameterHistoryResponseSchema
>;
