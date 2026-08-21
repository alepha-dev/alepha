import { AlephaError } from "alepha";
import { $logger } from "alepha/logger";

import type { RoomPrimitiveOptions } from "../interfaces/RoomInterfaces.ts";
import type {
  EmitOptions,
  WebSocketPrimitiveOptions,
} from "../interfaces/WebSocketInterfaces.ts";
import type { TWSObject } from "../primitives/$channel.ts";
import { WebSocketServerProvider } from "./WebSocketServerProvider.ts";

/**
 * Cloudflare Durable Object binding name generated into wrangler.jsonc by the
 * build. Reads from `cloudflare.env[WEBSOCKET_DEFAULT_BINDING]`.
 */
export const WEBSOCKET_DEFAULT_BINDING = "ALEPHA_WEBSOCKET";

/**
 * Minimal shape of the CF DurableObjectNamespace we depend on.
 */
interface DurableObjectNamespaceLike {
  idFromName(name: string): unknown;
  get(id: unknown): {
    broadcast(
      message: unknown,
      criteria: { exceptConnectionIds?: string[] },
    ): Promise<void>;
    callRoom(
      channelPath: string,
      roomId: string,
      method: string,
      args: unknown[],
    ): Promise<unknown>;
  };
}

/**
 * WebSocket server provider backed by Cloudflare Durable Objects.
 *
 * One DO per `channelPath:roomId`. Server-initiated emit is room-scoped:
 * roomId/roomIds resolve to DO stubs and call their broadcast RPC. Non-room
 * targeting (userId(s), connectionId(s), or channel-wide) is not supported in
 * v1 and throws - see docs. The inbound path (client message -> handler ->
 * reply) runs inside the DO and never reaches this provider.
 */
export class CloudflareDurableObjectWebSocketServerProvider extends WebSocketServerProvider {
  protected readonly log = $logger();
  protected readonly endpoints = new Map<
    string,
    WebSocketPrimitiveOptions<any, any>
  >();

  public registerEndpoint<TClient extends TWSObject, TServer extends TWSObject>(
    config: WebSocketPrimitiveOptions<TClient, TServer>,
  ): void {
    this.endpoints.set(config.channel.options.path, config);
  }

  public getEndpoint(channelPath: string) {
    return this.endpoints.get(channelPath);
  }

  public async emit<TClient extends TWSObject>(
    channelPath: string,
    options: EmitOptions<TClient>,
  ): Promise<void> {
    if (
      options.userId ||
      options.userIds ||
      options.connectionId ||
      options.connectionIds
    ) {
      throw new AlephaError(
        "Cloudflare WebSocket provider supports room-targeted emit only " +
          "(roomId/roomIds). user/connection targeting is not available.",
      );
    }
    const roomIds =
      options.roomIds ?? (options.roomId ? [options.roomId] : undefined);
    if (!roomIds || roomIds.length === 0) {
      throw new AlephaError(
        "Cloudflare WebSocket provider requires roomId/roomIds for emit " +
          "(channel-wide broadcast is not supported).",
      );
    }
    const ns = this.getNamespace();
    await Promise.all(
      roomIds.map(async (roomId) => {
        const stub = ns.get(ns.idFromName(`${channelPath}:${roomId}`));
        await stub.broadcast(options.message, {
          exceptConnectionIds: options.exceptConnectionIds,
        });
      }),
    );
  }

  // -------------------------------------------------------------------------
  // Stateful rooms ($room). The engine lives inside each room's Durable
  // Object; this main-isolate provider only routes calls to the right stub.
  // -------------------------------------------------------------------------

  protected readonly roomEndpoints = new Map<
    string,
    RoomPrimitiveOptions<any, any, any>
  >();

  public registerRoom(options: RoomPrimitiveOptions<any, any, any>): void {
    this.roomEndpoints.set(options.channel.options.path, options);
  }

  public getRoomEndpoint(
    channelPath: string,
  ): RoomPrimitiveOptions<any, any, any> | undefined {
    return this.roomEndpoints.get(channelPath);
  }

  public async callRoom(
    channelPath: string,
    roomId: string,
    method: string,
    args: unknown[] = [],
  ): Promise<unknown> {
    const ns = this.getNamespace();
    const stub = ns.get(ns.idFromName(`${channelPath}:${roomId}`));
    return stub.callRoom(channelPath, roomId, method, args);
  }

  public async broadcastToRoom(
    channelPath: string,
    roomId: string,
    message: unknown,
    options?: { exceptConnectionIds?: string[] },
  ): Promise<void> {
    const ns = this.getNamespace();
    const stub = ns.get(ns.idFromName(`${channelPath}:${roomId}`));
    await stub.broadcast(message, {
      exceptConnectionIds: options?.exceptConnectionIds,
    });
  }

  public getConnections() {
    return [];
  }

  public getRoomConnections() {
    return [];
  }

  public getUserConnections() {
    return [];
  }

  /**
   * Not supported on this runtime.
   *
   * Connections live inside room Durable Objects, and the main isolate holds
   * no handle to them — there is nothing here to close. It used to return
   * silently, so a caller believed it had disconnected someone when it had
   * not. Warn instead: a no-op that looks like success is worse than one that
   * says what it is.
   */
  public async closeConnection(connectionId?: string): Promise<void> {
    this.log.warn(
      "closeConnection() is not supported on Cloudflare: connections live " +
        "inside room Durable Objects and cannot be closed from the main " +
        "isolate. Close from inside the room instead.",
      { connectionId },
    );
  }

  protected getNamespace(): DurableObjectNamespaceLike {
    const env = this.alepha.store.get("cloudflare.env") as
      | Record<string, unknown>
      | undefined;
    if (!env) {
      throw new AlephaError(
        "Cloudflare Workers environment not found in Alepha store under 'cloudflare.env'.",
      );
    }
    const binding = env[WEBSOCKET_DEFAULT_BINDING] as
      | DurableObjectNamespaceLike
      | undefined;
    if (!binding) {
      throw new AlephaError(
        `Durable Object binding '${WEBSOCKET_DEFAULT_BINDING}' not found in Cloudflare Workers environment.`,
      );
    }
    return binding;
  }
}
