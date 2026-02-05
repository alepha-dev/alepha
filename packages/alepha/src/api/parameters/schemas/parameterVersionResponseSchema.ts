import { type Static, t } from "alepha";
import { parameterResponseSchema } from "./parameterResponseSchema.ts";

/**
 * Parameter version response schema.
 */
export const parameterVersionResponseSchema = t.object({
  parameter: t.optional(parameterResponseSchema),
});

export type ParameterVersionResponse = Static<
  typeof parameterVersionResponseSchema
>;
