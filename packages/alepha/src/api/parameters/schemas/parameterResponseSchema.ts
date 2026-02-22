import { type Static, t } from "alepha";
import { parameters } from "../entities/parameters.ts";
import { parameterStatusSchema } from "./parameterStatusSchema.ts";

/**
 * Parameter response schema for API responses.
 * Extends the entity schema with a calculated status field.
 * Status is derived from activationDate at query time, not stored.
 */
export const parameterResponseSchema = t.extend(parameters.schema, {
  status: parameterStatusSchema,
});

export type ParameterResponse = Static<typeof parameterResponseSchema>;
