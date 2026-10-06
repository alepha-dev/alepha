import { type Infer, z } from "alepha";

import { estateCommands } from "../entities/estateCommands.ts";

/**
 * A command as the estate page lists it. The whole row: nothing on it is a
 * secret, by construction of the payload (see `estateCommandPayloadSchema`).
 */
export const estateCommandResourceSchema = estateCommands.schema;

export type EstateCommandResource = Infer<typeof estateCommandResourceSchema>;

/**
 * A command as the queue page lists it: the row plus who asked, by name.
 *
 * `requestedBy` is a bare uuid on the row and is set null when the person is
 * deleted, because the command outlives them. The name is resolved for the
 * whole page in one query rather than per row, and stays absent when the
 * person is gone - which reads correctly as "nobody to attribute this to".
 */
export const estateCommandListItemSchema = estateCommandResourceSchema.extend({
  requestedByName: z.string().max(200).optional(),
});

export type EstateCommandListItem = Infer<typeof estateCommandListItemSchema>;
