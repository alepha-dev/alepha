import { DurableObject } from "cloudflare:workers";
import { WebSocketRoom } from "./WebSocketRoom.ts";

/**
 * Durable Object that hosts one room's WebSocket connections on Cloudflare.
 *
 * This class is intentionally a thin adapter: every entry point forwards
 * straight to a `WebSocketRoom` instance, which holds all the actual logic
 * and has zero dependency on `cloudflare:workers`. That module does not exist
 * under Vitest, so this file must never be imported from a `.spec.ts` - it is
 * only reached via the generated workerd entry point
 * (`index.workerd.ts`).
 *
 * One instance per `channelPath:roomId` (addressed by the provider via
 * idFromName). Uses the WebSocket Hibernation API so idle rooms cost nothing
 * and survive isolate eviction. The user's `$websocket` handler runs INSIDE
 * this object, so `reply()` fans out over this DO's own sockets with no
 * cross-isolate hop. The DO replaces the `$topic` bus used by the Node
 * provider.
 */
export class AlephaWebSocketDurableObject extends DurableObject {
  protected readonly room: WebSocketRoom;

  constructor(ctx: any, env: any) {
    super(ctx, env);
    this.room = new WebSocketRoom(this.ctx, this.env);
  }

  /**
   * Upgrade entry. Forwarded here by the worker `fetch` handler with the
   * resolved identity on internal headers.
   */
  async fetch(request: Request): Promise<Response> {
    return this.room.fetch(request);
  }

  /**
   * Hibernation-API message entry point.
   */
  async webSocketMessage(ws: any, data: string | ArrayBuffer): Promise<void> {
    return this.room.webSocketMessage(ws, data);
  }

  /**
   * Hibernation-API close entry point.
   */
  async webSocketClose(ws: any): Promise<void> {
    return this.room.webSocketClose(ws);
  }

  /**
   * RPC invoked by the Cloudflare provider for server-initiated, room-scoped
   * broadcasts.
   */
  async broadcast(
    message: unknown,
    criteria: { exceptConnectionIds?: string[] } = {},
  ): Promise<void> {
    return this.room.broadcast(message, criteria);
  }

  /**
   * RPC for a server-side `$room` method (coordinator/presence). channel/room
   * arrive as arguments because an RPC carries no headers.
   */
  async callRoom(
    channelPath: string,
    roomId: string,
    method: string,
    args: unknown[] = [],
  ): Promise<unknown> {
    return this.room.callRoom(channelPath, roomId, method, args);
  }

  /**
   * Durable Object alarm handler: the room tick-loop watchdog. Recovers a
   * ticking room after a rare mid-connection isolate reset.
   */
  async alarm(): Promise<void> {
    return this.room.alarm();
  }
}
