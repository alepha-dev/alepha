import { type Infer, z } from "alepha";
import { $logger } from "alepha/logger";
import { $topic } from "alepha/topic";

/**
 * WebSocket message distribution event
 */
const webSocketMessageSchema = {
  payload: z.object({
    /**
     * Channel path (e.g., "/ws/chat")
     */
    channelPath: z.text(),

    /**
     * Target room ID(s)
     */
    roomIds: z.array(z.text()).optional(),

    /**
     * Target user ID(s)
     */
    userIds: z.array(z.text()).optional(),

    /**
     * Target connection ID(s)
     */
    connectionIds: z.array(z.text()).optional(),

    /**
     * Exclude connection ID(s) from receiving the message
     */
    exceptConnectionIds: z.array(z.text()).optional(),

    /**
     * Exclude user ID(s) from receiving the message
     */
    exceptUserIds: z.array(z.text()).optional(),

    /**
     * The message payload to send
     */
    message: z.any(),
  }),
};

/**
 * WebSocket Topic Service
 *
 * Manages pub/sub messaging for WebSocket connections across multiple server instances.
 * Uses alepha/topic for cross-instance message distribution, enabling horizontal scaling.
 *
 * When a WebSocket message needs to be sent:
 * 1. Server instance A publishes to the topic
 * 2. All server instances (A, B, C, etc.) receive the message
 * 3. Each instance sends to its local connections that match the criteria
 *
 * This enables:
 * - Multiple server instances handling WebSocket connections
 * - Redis-backed message distribution (with alepha/topic/redis)
 * - Horizontal scaling without losing messages
 */
export class WebSocketTopicService {
  protected readonly log = $logger();

  /**
   * Handler function to be called when a message is received from the topic
   * This is set by the WebSocket provider during initialization
   */
  public messageHandler?: (
    event: Infer<(typeof webSocketMessageSchema)["payload"]>,
  ) => Promise<void>;

  /**
   * Topic for distributing WebSocket messages across server instances
   */
  public readonly topic = $topic({
    name: "websocket:broadcast",
    description:
      "Distributes WebSocket messages across server instances for horizontal scaling",
    schema: webSocketMessageSchema,
    handler: async (message) => {
      if (this.messageHandler) {
        await this.messageHandler(message.payload);
      }
    },
  });

  /**
   * Publish a message to be distributed across all server instances
   */
  public async publish(
    event: Infer<(typeof webSocketMessageSchema)["payload"]>,
  ): Promise<void> {
    await this.topic.publish(event);
  }

  /**
   * Set the handler for incoming messages
   */
  public setMessageHandler(
    handler: (
      event: Infer<(typeof webSocketMessageSchema)["payload"]>,
    ) => Promise<void>,
  ): void {
    this.messageHandler = handler;
  }
}
