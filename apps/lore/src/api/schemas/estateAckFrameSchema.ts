import { type Infer, z } from "alepha";

/**
 * What a machine says about a command, wire format v1: `running` on pickup
 * (with a `step` for a deploy's progress), then `done` or `failed` with a
 * `reason`. Scoped by the connection it arrives on: a machine can only
 * acknowledge its own estate's commands, whatever id it names.
 */
export const estateAckFrameSchema = z.object({
  type: z.literal("ack"),
  id: z.uuid(),
  status: z.enum(["running", "done", "failed"]),
  step: z.string().max(32).optional(),
  reason: z.string().max(2000).optional(),
});

export type EstateAckFrame = Infer<typeof estateAckFrameSchema>;
