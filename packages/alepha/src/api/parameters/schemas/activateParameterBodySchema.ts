import type { Infer } from "alepha";
import { parameters } from "../entities/parameters.ts";

/**
 * Activate parameter body schema.
 *
 * Creator fields are omitted; the controller captures the authenticated user
 * server-side.
 */
export const activateParameterBodySchema = parameters.schema.pick({
  version: true,
});

export type ActivateParameterBody = Infer<typeof activateParameterBodySchema>;
