import {
  createDescriptor,
  Descriptor,
  KIND,
  type TObject,
  type TString,
  type TUnion,
} from "alepha";

export type TWSObject = TObject | TUnion;

/**
 * Channel descriptor options
 */
export interface ChannelDescriptorOptions<
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
     * Optional room ID schema validation
     * Default: t.text() (any string)
     * Can be enforced at application level: t.uuid(), t.regex(/^[a-f0-9\-]{36}$/)
     */
    roomId?: TString;

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
 * Channels are reusable across multiple WebSocket server endpoints and client connections.
 * They define the "vocabulary" for communication - the schema for messages flowing
 * in both directions (server→client and client→server).
 *
 * @example
 * ```typescript
 * const chatChannel = $channel({
 *   path: "/ws/chat",
 *   description: "Real-time chat channel",
 *   schema: {
 *     // Server → Client messages
 *     in: t.union([
 *       t.object({
 *         type: t.const("append"),
 *         content: t.string(),
 *         username: t.string()
 *       }),
 *       t.object({
 *         type: t.const("remove"),
 *         messageId: t.uuid()
 *       })
 *     ]),
 *     // Client → Server messages
 *     out: t.object({
 *       content: t.text()
 *     })
 *   }
 * });
 * ```
 */
export const $channel = <TClient extends TWSObject, TServer extends TWSObject>(
  options: ChannelDescriptorOptions<TClient, TServer>,
): ChannelDescriptor<TClient, TServer> => {
  return createDescriptor(ChannelDescriptor<TClient, TServer>, options);
};

// ---------------------------------------------------------------------------------------------------------------------

export class ChannelDescriptor<
  TClient extends TWSObject,
  TServer extends TWSObject,
> extends Descriptor<ChannelDescriptorOptions<TClient, TServer>> {
  // Channels are just schema definitions - no initialization logic needed
}

$channel[KIND] = ChannelDescriptor;
