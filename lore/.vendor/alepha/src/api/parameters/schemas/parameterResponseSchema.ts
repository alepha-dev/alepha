import type { Infer } from "alepha";

import { parameters } from "../entities/parameters.ts";
import { parameterCreatorSummarySchema } from "./parameterCreatorSummarySchema.ts";
import { parameterStatusSchema } from "./parameterStatusSchema.ts";

/**
 * Parameter response schema for API responses.
 * Extends the entity schema with a calculated status field.
 * Status is derived from activationDate at query time, not stored.
 *
 * `creator` is embedded on read via a best-effort left join on `creatorId`
 * (see `parameterCreatorSummarySchema`); it is not a stored column.
 */
export const parameterResponseSchema = parameters.schema.extend({
  status: parameterStatusSchema,
  creator: parameterCreatorSummarySchema.optional(),
});

export type ParameterResponse = Infer<typeof parameterResponseSchema>;
