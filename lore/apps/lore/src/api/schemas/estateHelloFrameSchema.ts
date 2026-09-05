import { type Infer, z } from "alepha";

/**
 * The first frame a machine sends after the handshake, wire format v1.
 *
 * It exists because of where the code runs on production: the `$websocket`
 * handler lives inside the Durable Object holding the socket, and a handler
 * can `reply()` into its own room as a local fan-out, while `onConnect` has
 * no reply and an `emit()` from inside the object would be the object calling
 * its own stub. So the machine opens the conversation, and Lore answers with
 * `welcome` and everything queued for it, in one place, the same way on Node.
 */
export const estateHelloFrameSchema = z.object({
  type: z.literal("hello"),
});

export type EstateHelloFrame = Infer<typeof estateHelloFrameSchema>;
