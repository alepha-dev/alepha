import { type Static, t } from "alepha";
import { parameters } from "../entities/parameters.ts";

/**
 * Activate parameter body schema.
 * Uses t.pick for version and creator fields.
 */
export const activateParameterBodySchema = t.pick(parameters.schema, [
  "version",
  "creatorId",
  "creatorName",
]);

export type ActivateParameterBody = Static<typeof activateParameterBodySchema>;
