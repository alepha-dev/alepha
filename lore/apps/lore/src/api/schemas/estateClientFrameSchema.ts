import { type Infer, z } from "alepha";

import { estateAckFrameSchema } from "./estateAckFrameSchema.ts";
import { estateHelloFrameSchema } from "./estateHelloFrameSchema.ts";
import { estateInventoryFrameSchema } from "./estateInventoryFrameSchema.ts";
import { estateStatsFrameSchema } from "./estateStatsFrameSchema.ts";

/**
 * Everything a machine sends Lore, wire format v1: `hello`, `ack`, `stats`
 * and `inventory`. The `out` half of the estates channel, in `$channel`'s
 * vocabulary (client to server). A bare JSON object per frame; the framework
 * accepts `{ message }` too but the connector sends the object itself.
 */
export const estateClientFrameSchema = z.union([
  estateHelloFrameSchema,
  estateAckFrameSchema,
  estateStatsFrameSchema,
  estateInventoryFrameSchema,
]);

export type EstateClientFrame = Infer<typeof estateClientFrameSchema>;
