import { parameters } from "../entities/parameters.ts";

/**
 * Parameter name and version param schema.
 * Uses z.pick from entity for consistency.
 */
export const parameterVersionParamSchema = parameters.schema.pick({
  name: true,
  version: true,
});
