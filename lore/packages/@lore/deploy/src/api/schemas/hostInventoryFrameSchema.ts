import { type Infer, z } from "alepha";

import { hostInventoryAppSchema } from "./hostInventoryAppSchema.ts";
import { hostInventoryMachineSchema } from "./hostInventoryMachineSchema.ts";
import { hostInventoryStackSchema } from "./hostInventoryStackSchema.ts";

/**
 * Everything a machine can say about itself in one frame, wire format v1.
 *
 * ⚠️ **Part of v1, not a version of its own.** `HOST_PROTOCOL_VERSION` stays
 * `1`: Bay is redeployed to the OVH box whenever we choose, so there is no
 * fleet in the field to negotiate with, and an older Bay that never sends this
 * reads to Lore exactly like a machine that has not reported yet, which is a
 * state the console needs anyway.
 *
 * Pushed on connect right after `welcome`, on the stats tick, after any
 * command that changes state, and in answer to a `query`. `stats` is untouched
 * and keeps carrying the two percentages the host list badge reads.
 *
 * The 200-app cap bounds the stored row and the page, not the socket: a full
 * frame at every cap is under 200 KB against a Workers websocket ceiling of
 * 32 MiB. A host with 500 instances is a bug or an attack, not a page.
 */
export const hostInventoryFrameSchema = z.object({
  type: z.literal("inventory"),
  /** The machine's own clock, kept as reported; Lore stamps its own beside it. */
  at: z.string().max(40),
  // Bay wire v1: the machine block keeps the key `host` on the wire (Bay's
  // `inventory.go`); Lore stores and serves it as `machine`.
  host: hostInventoryMachineSchema,
  apps: z.array(hostInventoryAppSchema).max(200),
  stacks: z.array(hostInventoryStackSchema).max(100).optional(),
});

export type HostInventoryFrame = Infer<typeof hostInventoryFrameSchema>;
