import { t } from "alepha";
import { parameters } from "../entities/parameters.ts";

/**
 * Parameter name and version param schema.
 * Uses t.pick from entity for consistency.
 */
export const parameterVersionParamSchema = t.pick(parameters.schema, [
  "name",
  "version",
]);
