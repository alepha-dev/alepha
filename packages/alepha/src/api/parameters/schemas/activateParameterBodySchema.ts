import { type Static, t } from "alepha";
import { parameters } from "../entities/parameters.ts";

/**
 * Activate parameter body schema.
 *
 * Creator fields are omitted; the controller captures the authenticated user
 * server-side.
 */
export const activateParameterBodySchema = t.pick(parameters.schema, [
  "version",
]);

export type ActivateParameterBody = Static<typeof activateParameterBodySchema>;
