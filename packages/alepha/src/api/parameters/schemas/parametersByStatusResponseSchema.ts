import { type Static, t } from "alepha";
import { parameterResponseSchema } from "./parameterResponseSchema.ts";

/**
 * Parameters by status response schema.
 */
export const parametersByStatusResponseSchema = t.object({
  parameters: t.array(parameterResponseSchema),
});

export type ParametersByStatusResponse = Static<
  typeof parametersByStatusResponseSchema
>;
