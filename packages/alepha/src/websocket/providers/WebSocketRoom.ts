import { type Alepha, AlephaError, SchemaValidator } from "alepha";
import type { WebSocketPrimitiveOptions } from "../interfaces/WebSocketInterfaces.ts";
import { WebSocketServerProvider } from "./WebSocketServerProvider.ts";

/**
 * Per-socket attachment persisted via the hibernation API's
 * `serializeAttachment` / `deserializeAttachment`, so identity survives the
 * Durable Object being evicted and re-hydrated between messages.
 */
export interface WsAttachment {
  connectionId: string;
  userId?: string;
  roomId: string;
  channelPath: string;
}

/**
 * Minimal slice of the Cloudflare Durable Object state (`DurableObjectState`)
 * this class depends on. Kept local (rather than importing the real type from
 * `cloudflare:workers`) so this file has zero runtime or type dependency on
 * the `cloudflare:workers` module and can be constructed with a plain fake in
 * tests run under Vitest.
 */
export interface WebSocketRoomState {
  /**
   * Accept a raw WebSocket and put it under hibernation management.
   */
  acceptWebSocket(ws: any): void;

  /**
   * All WebSockets currently held by this Durable Object (including
   * hibernated ones).
   */
  getWebSockets(): any[];
}

/**
 * All the logic for hosting one room's hibernatable WebSockets on Cloudflare.
 *
 * This class holds zero dependency on `cloudflare:workers` so it can be
 * unit-tested directly under Vitest (where that module does not exist). The
 * thin `AlephaWebSocketDurableObject` wrapper (which does import
 * `cloudflare:workers`) simply constructs one of these with its own
 * `ctx`/`env` and forwards every Durable Object entry point to it.
 *
 * One instance per `channelPath:roomId` (addressed by the provider via
 * idFromName). Uses the WebSocket Hibernation API so idle rooms cost nothing
 * and survive isolate eviction. The user's `$websocket` handler runs INSIDE
 * this object, so `reply()` fans out over this room's own sockets with no
 * cross-isolate hop. The Durable Object replaces the `$topic` bus used by the
 * Node provider.
 */
export class WebSocketRoom {
  protected started = false;

  constructor(
    protected readonly ctx: WebSocketRoomState,
    protected readonly env: Record<string, unknown>,
  ) {}

  /**
   * Upgrade entry. Forwarded here by the worker `fetch` handler with the
   * resolved identity on internal headers.
   */
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const channelPath =
      request.headers.get("x-alepha-ws-channel") ?? url.pathname;
    const roomId = request.headers.get("x-alepha-ws-room") ?? "default";
    const userId = request.headers.get("x-alepha-ws-user") ?? undefined;
    const connectionId =
      request.headers.get("x-alepha-ws-conn") ?? `ws-${crypto.randomUUID()}`;

    // @ts-expect-error WebSocketPair is a Workers runtime global, not available in Node's lib.dom types.
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];

    this.ctx.acceptWebSocket(server);
    const attachment: WsAttachment = {
      connectionId,
      userId,
      roomId,
      channelPath,
    };
    server.serializeAttachment(attachment);

    await this.withEndpoint(channelPath, async (endpoint) => {
      await endpoint.onConnect?.({ connectionId, userId, roomIds: [roomId] });
    });

    // @ts-expect-error `webSocket` on ResponseInit is a Workers-only extension not present in lib.dom's Response type.
    return new Response(null, { status: 101, webSocket: client });
  }

  /**
   * Hibernation-API message entry point, invoked by the Durable Object
   * wrapper for every inbound client frame.
   */
  async webSocketMessage(ws: any, data: string | ArrayBuffer): Promise<void> {
    const att = ws.deserializeAttachment() as WsAttachment;
    const raw =
      typeof data === "string" ? data : new TextDecoder().decode(data);
    await this.handleRawMessage(ws, att, raw);
  }

  /**
   * Hibernation-API close entry point, invoked by the Durable Object wrapper
   * when a client socket disconnects.
   */
  async webSocketClose(ws: any): Promise<void> {
    const att = ws.deserializeAttachment() as WsAttachment | null;
    if (!att) return;
    await this.withEndpoint(att.channelPath, async (endpoint) => {
      await endpoint.onDisconnect?.({
        connectionId: att.connectionId,
        userId: att.userId,
        roomIds: [att.roomId],
      });
    });
  }

  /**
   * RPC invoked by the Cloudflare provider for server-initiated, room-scoped
   * broadcasts.
   */
  async broadcast(
    message: unknown,
    criteria: { exceptConnectionIds?: string[] } = {},
  ): Promise<void> {
    this.broadcastLocal(message, new Set(criteria.exceptConnectionIds ?? []));
  }

  /**
   * Parse + validate an inbound client message, then run the endpoint handler
   * with a room-scoped reply(). Extracted from webSocketMessage so it is unit
   * testable without the hibernation runtime.
   */
  protected async handleRawMessage(
    ws: any,
    att: WsAttachment,
    raw: string,
  ): Promise<void> {
    await this.withEndpoint(att.channelPath, async (endpoint) => {
      let parsed: any;
      try {
        parsed = JSON.parse(raw);
      } catch {
        return;
      }
      const message = parsed.message ?? parsed;
      const alepha = this.getAlepha();
      alepha
        .inject(SchemaValidator)
        .validate(endpoint.channel.options.schema.out, message, {
          trim: false,
          nullToUndefined: false,
          deleteUndefined: false,
        });

      const reply = async (opts: {
        message: unknown;
        exceptSelf?: boolean;
        exceptConnectionIds?: string[];
      }) => {
        const except = new Set(opts.exceptConnectionIds ?? []);
        if (opts.exceptSelf) except.add(att.connectionId);
        this.broadcastLocal(opts.message, except);
      };

      await endpoint.handler({
        connectionId: att.connectionId,
        userId: att.userId,
        roomId: att.roomId,
        message,
        reply,
      });
    });
  }

  /**
   * Send a message to every socket held by this Durable Object, skipping
   * excepted connection ids.
   */
  protected broadcastLocal(message: unknown, except: Set<string>): void {
    const serialized =
      typeof message === "string" ? message : JSON.stringify(message);
    for (const ws of this.ctx.getWebSockets()) {
      const att = ws.deserializeAttachment() as WsAttachment | null;
      if (att && except.has(att.connectionId)) continue;
      try {
        ws.send(serialized);
      } catch {
        // socket closing/closed — ignore
      }
    }
  }

  protected getAlepha(): Alepha {
    const alepha = (globalThis as any).__alepha as Alepha | undefined;
    if (!alepha) {
      throw new AlephaError("__alepha not found in Durable Object isolate");
    }
    return alepha;
  }

  /**
   * Boot the shared app graph on first use (bind this Durable Object's env),
   * then run fn with the endpoint registered for channelPath. No-op if no
   * such endpoint is registered.
   */
  protected async withEndpoint(
    channelPath: string,
    fn: (endpoint: WebSocketPrimitiveOptions<any, any>) => Promise<void>,
  ): Promise<void> {
    const alepha = this.getAlepha();
    if (!this.started) {
      alepha.set("cloudflare.env", this.env);
      alepha.loadEnv(this.env);
      await alepha.start();
      this.started = true;
    }
    const endpoint = alepha
      .inject(WebSocketServerProvider)
      .getEndpoint(channelPath);
    if (endpoint) await fn(endpoint);
  }
}
