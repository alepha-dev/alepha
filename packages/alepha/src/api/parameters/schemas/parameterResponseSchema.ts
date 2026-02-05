import type { Static } from "alepha";
import { parameters } from "../entities/parameters.ts";

/**
 * Parameter response schema for API responses.
 * Derived directly from the entity schema to avoid duplication.
 */
export const parameterResponseSchema = parameters.schema;

export type ParameterResponse = Static<typeof parameterResponseSchema>;
