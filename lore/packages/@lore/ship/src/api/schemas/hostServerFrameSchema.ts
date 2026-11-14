import { type Infer, z } from "alepha";

import { hostCommandFrameSchema } from "./hostCommandFrameSchema.ts";
import { hostQueryFrameSchema } from "./hostQueryFrameSchema.ts";
import { hostWelcomeFrameSchema } from "./hostWelcomeFrameSchema.ts";

/**
 * Everything Lore sends a machine, wire format v1: `welcome`, `config`,
 * `command` and `query`. The `in` half of the hosts channel, in
 * `$channel`'s vocabulary (server to client).
 *
 * The frame a socket receives carries one extra key, `__alephaRoom`, which
 * the framework stamps with the room id on both runtimes; a decoder that
 * ignores unknown keys never sees it.
 */
export const hostServerFrameSchema = z.union([
  hostWelcomeFrameSchema,
  hostCommandFrameSchema,
  hostQueryFrameSchema,
]);

export type HostServerFrame = Infer<typeof hostServerFrameSchema>;
