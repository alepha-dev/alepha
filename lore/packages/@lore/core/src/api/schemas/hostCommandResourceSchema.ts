import { type Infer, z } from "alepha";

import { hostCommands } from "../entities/hostCommands.ts";

/**
 * A command as the host page lists it. The whole row: nothing on it is a
 * secret, by construction of the payload (see `hostCommandPayloadSchema`).
 */
export const hostCommandResourceSchema = hostCommands.schema;

export type HostCommandResource = Infer<typeof hostCommandResourceSchema>;

/**
 * A command as the queue page lists it: the row plus who asked, by name.
 *
 * `requestedBy` is a bare uuid on the row and is set null when the person is
 * deleted, because the command outlives them. The name is resolved for the
 * whole page in one query rather than per row, and stays absent when the
 * person is gone - which reads correctly as "nobody to attribute this to".
 */
export const hostCommandListItemSchema = hostCommandResourceSchema.extend({
  requestedByName: z.string().max(200).optional(),
});

export type HostCommandListItem = Infer<typeof hostCommandListItemSchema>;
