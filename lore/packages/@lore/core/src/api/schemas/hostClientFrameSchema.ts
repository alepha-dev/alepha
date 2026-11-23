import { type Infer, z } from "alepha";

import { hostAckFrameSchema } from "./hostAckFrameSchema.ts";
import { hostEventFrameSchema } from "./hostEventFrameSchema.ts";
import { hostHelloFrameSchema } from "./hostHelloFrameSchema.ts";
import { hostInventoryFrameSchema } from "./hostInventoryFrameSchema.ts";
import { hostLogFrameSchema } from "./hostLogFrameSchema.ts";
import { hostStatsFrameSchema } from "./hostStatsFrameSchema.ts";

/**
 * Everything a machine sends Lore, wire format v1: `hello`, `ack`, `stats`,
 * `inventory`, `event` and `log`. The `out` half of the hosts channel, in `$channel`'s
 * vocabulary (client to server). A bare JSON object per frame; the framework
 * accepts `{ message }` too but the connector sends the object itself.
 */
export const hostClientFrameSchema = z.union([
  hostHelloFrameSchema,
  hostAckFrameSchema,
  hostStatsFrameSchema,
  hostInventoryFrameSchema,
  hostEventFrameSchema,
  hostLogFrameSchema,
]);

export type HostClientFrame = Infer<typeof hostClientFrameSchema>;
