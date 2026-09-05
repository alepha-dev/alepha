import { type Infer, z } from "alepha";

import { ESTATE_COMMAND_KINDS } from "../entities/estateCommands.ts";
import { estateCommandPayloadSchema } from "./estateCommandPayloadSchema.ts";

/**
 * The `command` frame Lore pushes to a machine, wire format v1 (folio #1198).
 *
 * `{ type: "command", id, kind, app, environment, artifact? }`. The Go side
 * mirrors this struct by hand; the `$channel` in #1782 composes it with the
 * `welcome` and `config` frames, and the end-to-end test (#1628) is what
 * catches the two drifting apart.
 */
export const estateCommandFrameSchema = estateCommandPayloadSchema.extend({
  type: z.literal("command"),
  id: z.uuid(),
  kind: z.enum(ESTATE_COMMAND_KINDS),
});

export type EstateCommandFrame = Infer<typeof estateCommandFrameSchema>;
