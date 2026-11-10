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
  /**
   * Where a deploy answers, on its terminal `done` ack only (#Q3155): the
   * `https://<domain>/` `bay deploy` prints. Bounded like `deployments.url`.
   */
  url: z.string().max(500).optional(),
  /**
   * Where the deployed instance's `APP_SECRET` came from (`kept`,
   * `snapshot`, `lore`, `minted`), on a deploy's `done` ack. Never the key.
   */
  appSecretSource: z.string().max(20).optional(),
  /**
   * What the deploy has to say without failing: it started on an empty
   * database, or on a key minted over restored data. Bounded like `reason`.
   */
  warning: z.string().max(2000).optional(),
});

export type EstateAckFrame = Infer<typeof estateAckFrameSchema>;
