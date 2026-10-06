import { type Infer, z } from "alepha";

/**
 * "Tell me what you are running, now", wire format v1.
 *
 * ⚠️ Deliberately NOT a command. A row in `estate_commands` buys idempotency
 * by id, a queue, an ack, redelivery on reconnect and a sweep, and this needs
 * none of them: the failure mode of a lost refresh is that the person clicks
 * the button again. So this frame is transient, pushed only when the socket
 * is live, and the machine answers with an ordinary `inventory` frame that
 * lands through the path that already exists.
 *
 * `logs` went the other way and IS a command, because it has an execution
 * that can fail, a reason worth keeping and a result to correlate.
 *
 * Carries no fields at all. Adding one would make this a request with
 * arguments, which is the shape that turns into a command.
 *
 * An older Bay logs an unknown frame type at debug and moves on, which is the
 * property that lets "no protocol bump" hold.
 */
export const estateQueryFrameSchema = z.object({
  type: z.literal("query"),
});

export type EstateQueryFrame = Infer<typeof estateQueryFrameSchema>;
