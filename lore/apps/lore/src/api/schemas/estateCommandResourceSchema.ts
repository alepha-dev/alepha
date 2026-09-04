import { type Infer } from "alepha";

import { estateCommands } from "../entities/estateCommands.ts";

/**
 * A command as the estate page lists it. The whole row: nothing on it is a
 * secret, by construction of the payload (see `estateCommandPayloadSchema`).
 */
export const estateCommandResourceSchema = estateCommands.schema;

export type EstateCommandResource = Infer<typeof estateCommandResourceSchema>;
