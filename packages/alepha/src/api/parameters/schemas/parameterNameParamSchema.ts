import { parameters } from "../entities/parameters.ts";

/**
 * Parameter name param schema.
 * Uses z.pick from entity for consistency.
 */
export const parameterNameParamSchema = parameters.schema.pick({ name: true });
