import {
  createPrimitive,
  KIND,
  Primitive,
  type ZObject,
  type ZodString,
  type ZodUnion,
} from "alepha";

export type TWSObject = ZObject | ZodUnion;

/**
 * Channel primitive options
 */
export interface ChannelPrimitiveOptions<
  TClient extends TWSObject,
  TServer extends TWSObject,
> {
  /**
   * WebSocket endpoint path (e.g., "/ws/chat")
   */
  path: string;

  /**
   * Optional description for documentation
   */
  description?: string;

  /**
   * Message schemas for bidirectional communication
   */
  schema: {
    /**
     * Shape a client-named room id must have, e.g. `z.uuid()` or
     * `z.text({ pattern: /^[a-f0-9-]{36}$/ })`. Any string when unset.
     *
     * Checked at the handshake on both engines: a join naming a room this
     * rejects is closed with code 1008 and the reason "Invalid room id", and
     * every id of a multi-room join is checked, not just the first.
     *
     * The implicit `default` room is never validated. It is what a client
     * that named no room gets, so it is the framework's fallback rather than
     * a choice, and validating it would refuse every connection that simply
     * omitted the parameter.
     */
    roomId?: ZodString;

    /**
     * Messages from server to client
     * This is what clients will receive
     */
    in: TClient;

    /**
     * Messages from client to server
     * This is what the server will receive
     */
    out: TServer;
  };
}

/**
 * Defines a WebSocket channel with specified client and server message schemas.
 *
 * Channels must be defined as class properties to be registered in the Alepha context.
 * They define the "vocabulary" for communication - the schema for messages flowing
 * in both directions (server→client and client→server).
 *
 * @example Server-side with $websocket
 * ```typescript
 * class ChatController {
 *   // Channel must be defined inside a class
 *   chatChannel = $channel({
 *     path: "/ws/chat",
 *     description: "Real-time chat channel",
 *     schema: {
 *       // Server → Client messages
 *       in: z.union([
 *         z.object({
 *           type: z.const("append"),
 *           content: z.text(),
 *           username: z.text()
 *         }),
 *         z.object({
 *           type: z.const("system"),
 *           message: z.text()
 *         })
 *       ]),
 *       // Client → Server messages
 *       out: z.object({
 *         content: z.text()
 *       })
 *     }
 *   });
 *
 *   chat = $websocket({
 *     channel: this.chatChannel,
 *     handler: async ({ message, reply }) => {
 *       await reply({
 *         message: { type: "append", content: message.content, username: "user" }
 *       });
 *     }
 *   });
 * }
 * ```
 *
 * @example Browser-side with useRoom
 * ```typescript
 * // Define channel in a class for browser context
 * class ChatClient {
 *   chatChannel = $channel({
 *     path: "/ws/chat",
 *     schema: { in: inSchema, out: outSchema }
 *   });
 * }
 *
 * // Use in React component
 * function Chat() {
 *   const client = useInject(ChatClient);
 *   const chat = useRoom({ roomId: "lobby", channel: client.chatChannel, handler: ... }, []);
 * }
 * ```
 */
export const $channel = <TClient extends TWSObject, TServer extends TWSObject>(
  options: ChannelPrimitiveOptions<TClient, TServer>,
): ChannelPrimitive<TClient, TServer> => {
  return createPrimitive(ChannelPrimitive<TClient, TServer>, options);
};

// ---------------------------------------------------------------------------------------------------------------------

export class ChannelPrimitive<
  TClient extends TWSObject,
  TServer extends TWSObject,
> extends Primitive<ChannelPrimitiveOptions<TClient, TServer>> {
  // Channels are just schema definitions - no initialization logic needed
}

$channel[KIND] = ChannelPrimitive;
