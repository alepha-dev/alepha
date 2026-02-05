import { t } from "alepha";
import { parameters } from "../entities/parameters.ts";

/**
 * Parameter name param schema.
 * Uses t.pick from entity for consistency.
 */
export const parameterNameParamSchema = t.pick(parameters.schema, ["name"]);
