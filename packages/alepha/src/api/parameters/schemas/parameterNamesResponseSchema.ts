import { type Static, t } from "alepha";

/**
 * Parameter names list response schema.
 */
export const parameterNamesResponseSchema = t.object({
  names: t.array(t.text()),
});

export type ParameterNamesResponse = Static<
  typeof parameterNamesResponseSchema
>;
