import {
  $inject,
  createDescriptor,
  Descriptor,
  KIND,
  type TSchema,
} from "@alepha/core";
import type { WebSocketConfig } from "../interfaces/WebSocketConnection.ts";
import { WebSocketServerProvider } from "../providers/WebSocketServerProvider.ts";

/**
 * Create a WebSocket endpoint.
 *
 * WebSockets provide real-time bidirectional communication between clients and servers.
 * This descriptor makes it easy to define WebSocket endpoints with full TypeScript type safety,
 * automatic message validation, and integrated security features.
 *
 * @example
 * ```typescript
 * class ChatController {
 *   chat = $websocket({
 *     path: "/ws/chat",
 *     description: "Real-time chat WebSocket",
 *     schema: {
 *       message: t.object({
 *         type: t.enum(["text", "image"]),
 *         content: t.text(),
 *         userId: t.text()
 *       })
 *     },
 *     handler: async ({ message, broadcast }) => {
 *       await broadcast(message);
 *     }
 *   });
 * }
 * ```
 */
export const $websocket = <TMessageSchema extends TSchema>(
  options: WebSocketConfig<TMessageSchema>,
): WebSocketDescriptor<TMessageSchema> => {
  return createDescriptor(WebSocketDescriptor<TMessageSchema>, options);
};

// ---------------------------------------------------------------------------------------------------------------------

export class WebSocketDescriptor<
  TMessageSchema extends TSchema,
> extends Descriptor<WebSocketConfig<TMessageSchema>> {
  protected readonly webSocketServerProvider = $inject(WebSocketServerProvider);

  protected onInit() {
    this.webSocketServerProvider.registerEndpoint(this.options);
  }
}

$websocket[KIND] = WebSocketDescriptor;
