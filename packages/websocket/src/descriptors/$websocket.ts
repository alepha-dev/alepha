import { $inject, createDescriptor, Descriptor, KIND } from "@alepha/core";
import type {
  EmitOptions,
  WebSocketDescriptorOptions,
} from "../interfaces/WebSocketInterfaces.ts";
import { WebSocketServerProvider } from "../providers/WebSocketServerProvider.ts";
import type { TWSObject } from "./$channel.ts";

/**
 * Defines a WebSocket server endpoint for a specific channel.
 *
 * Server-side only. Creates a WebSocket endpoint that:
 * - Accepts connections from clients
 * - Validates incoming messages against the channel schema
 * - Provides room-based messaging
 * - Integrates with @alepha/security for authentication (optional)
 * - Supports horizontal scaling via @alepha/topic
 *
 * @example
 * ```typescript
 * class ChatController {
 *   chat = $websocket({
 *     channel: chatChannel,
 *     handler: async ({ connectionId, userId, roomId, message, reply }) => {
 *       // Broadcast to all in room except sender
 *       await reply({
 *         message: {
 *           type: "append",
 *           username: userId,
 *           content: message.content
 *         },
 *         exceptSelf: true
 *       });
 *     }
 *   });
 *
 *   async broadcastAnnouncement(roomId: string, text: string) {
 *     await this.chat.emit({
 *       roomId,
 *       message: {
 *         type: "append",
 *         username: "System",
 *         content: text
 *       }
 *     });
 *   }
 * }
 * ```
 */
export const $websocket = <
  TClient extends TWSObject,
  TServer extends TWSObject,
>(
  options: WebSocketDescriptorOptions<TClient, TServer>,
): WebSocketDescriptor<TClient, TServer> => {
  return createDescriptor(WebSocketDescriptor<TClient, TServer>, options);
};

// ---------------------------------------------------------------------------------------------------------------------

export class WebSocketDescriptor<
  TClient extends TWSObject,
  TServer extends TWSObject,
> extends Descriptor<WebSocketDescriptorOptions<TClient, TServer>> {
  protected readonly webSocketServerProvider = $inject(WebSocketServerProvider);

  protected onInit() {
    this.webSocketServerProvider.registerEndpoint(this.options);
  }

  /**
   * Emit message to clients
   *
   * Send messages from the server to connected clients based on targeting criteria.
   * Messages are distributed across all server instances via pub/sub.
   *
   * @example
   * ```typescript
   * // Send to specific room
   * await websocket.emit({
   *   roomId: "room-123",
   *   message: { type: "update", data: {...} }
   * });
   *
   * // Send to specific user (all their connections)
   * await websocket.emit({
   *   userId: "user-456",
   *   message: { type: "notification", text: "Hello!" }
   * });
   *
   * // Send to multiple rooms, except certain users
   * await websocket.emit({
   *   roomIds: ["room-1", "room-2"],
   *   exceptUserIds: ["user-123"],
   *   message: { type: "broadcast", content: "System announcement" }
   * });
   * ```
   */
  public async emit(options: EmitOptions<TClient>): Promise<void> {
    await this.webSocketServerProvider.emit(
      this.options.channel.options.path,
      options,
    );
  }
}

$websocket[KIND] = WebSocketDescriptor;
