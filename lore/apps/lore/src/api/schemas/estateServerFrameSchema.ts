import { type Infer, z } from "alepha";

import { estateCommandFrameSchema } from "./estateCommandFrameSchema.ts";
import { estateQueryFrameSchema } from "./estateQueryFrameSchema.ts";
import { estateWelcomeFrameSchema } from "./estateWelcomeFrameSchema.ts";

/**
 * Everything Lore sends a machine, wire format v1: `welcome`, `config`,
 * `command` and `query`. The `in` half of the estates channel, in
 * `$channel`'s vocabulary (server to client).
 *
 * The frame a socket receives carries one extra key, `__alephaRoom`, which
 * the framework stamps with the room id on both runtimes; a decoder that
 * ignores unknown keys never sees it.
 */
export const estateServerFrameSchema = z.union([
  estateWelcomeFrameSchema,
  estateCommandFrameSchema,
  estateQueryFrameSchema,
]);

export type EstateServerFrame = Infer<typeof estateServerFrameSchema>;
