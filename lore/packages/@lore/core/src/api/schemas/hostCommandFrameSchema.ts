import { type Infer, z } from "alepha";

import { hostCommandPayloadSchema } from "./hostCommandPayloadSchema.ts";
import { HOST_COMMAND_KINDS } from "./hostCommandValues.ts";

/**
 * The `command` frame Lore pushes to a machine, wire format v1 (folio #1198).
 *
 * `{ type: "command", id, kind, app, environment, artifact? }`. The Go side
 * mirrors this struct by hand; the `$channel` in #1782 composes it with the
 * `welcome` and `config` frames, and the end-to-end test (#1628) is what
 * catches the two drifting apart.
 */
export const hostCommandFrameSchema = hostCommandPayloadSchema.extend({
  type: z.literal("command"),
  id: z.uuid(),
  kind: z.enum(HOST_COMMAND_KINDS),
});

export type HostCommandFrame = Infer<typeof hostCommandFrameSchema>;
