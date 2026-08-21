import { type Alepha, AlephaError, SchemaValidator } from "alepha";

import type {
  RoomClock,
  RoomPrimitiveOptions,
  RoomSocket,
} from "../interfaces/RoomInterfaces.ts";
import type { WebSocketPrimitiveOptions } from "../interfaces/WebSocketInterfaces.ts";
import { WebSocketChannelConnection } from "../services/WebSocketClient.ts";
import { RoomEngine } from "./RoomEngine.ts";
import { WebSocketServerProvider } from "./WebSocketServerProvider.ts";

/**
 * The Durable Object's own wall clock, driving a room's tick loop. The isolate
 * stays alive while the room holds an accepted WebSocket, so a `setInterval`
 * here keeps ticking for as long as the game is live and stops costing anything
 * the moment the room empties. Injectable so tests drive a deterministic clock.
 */
const defaultRoomClock: RoomClock = {
  setInterval: (fn, ms) => setInterval(fn, ms),
  clearInterval: (handle) =>
    clearInterval(handle as ReturnType<typeof setInterval>),
  now: () => Date.now(),
};

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
  /**
   * The upgrade URL's query parameters (first value per key), carried through
   * the hibernation attachment so `RoomSocket.query` survives isolate resets.
   * The Node provider exposes the same map; without it here, an application
   * that names the joining entity by query hint (`?hero=…`) refuses every
   * join on workerd while working perfectly in dev.
   */
  query?: Record<string, string>;
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

  /**
   * Durable Object storage, used only to schedule the tick-loop watchdog
   * alarm. Optional so this class stays constructible with a plain fake in
   * tests that don't exercise the watchdog.
   */
  storage?: {
    setAlarm(scheduledTime: number): void | Promise<void>;
  };
}

/**
 * How often the watchdog alarm fires while a room holds sockets. It exists to
 * recover from a rare mid-connection isolate reset: the hibernation API keeps
 * the sockets, but our in-memory engine is gone, so nothing is ticking. The
 * alarm re-hydrates the forgotten sockets (which restarts the loop) even with
 * no inbound traffic to trigger it.
 */
const ALARM_INTERVAL_MS = 10_000;

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

  /**
   * One {@link RoomEngine} per `channelPath:roomId` hosted in this Durable
   * Object (in practice a DO is a single room, but keyed for safety).
   */
  protected readonly roomEngines = new Map<string, RoomEngine<any, any, any>>();
  /** Per-connection application data bags, keyed by connectionId. */
  protected readonly dataBags = new Map<string, Record<string, unknown>>();
  /** Connection ids currently joined to their engine (for rehydrate). */
  protected readonly joined = new Set<string>();
  /** Whether a watchdog alarm is currently scheduled. */
  protected alarmScheduled = false;

  constructor(
    protected readonly ctx: WebSocketRoomState,
    protected readonly env: Record<string, unknown>,
    protected readonly clock: RoomClock = defaultRoomClock,
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
    const query = Object.fromEntries(url.searchParams);

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
      query,
    };
    server.serializeAttachment(attachment);

    await this.onSocketOpen(server, attachment);

    // @ts-expect-error `webSocket` on ResponseInit is a Workers-only extension not present in lib.dom's Response type.
    return new Response(null, { status: 101, webSocket: client });
  }

  /**
   * Post-accept admission, shared by the real `fetch` and by tests (which
   * cannot construct a Workers `WebSocketPair`). Routes a stateful `$room`
   * socket into its engine's join lifecycle, or falls back to the stateless
   * `$websocket` `onConnect`.
   */
  protected async onSocketOpen(
    server: any,
    attachment: WsAttachment,
  ): Promise<void> {
    const { channelPath, roomId, connectionId, userId } = attachment;
    const roomEngine = await this.getRoomEngine(channelPath, roomId);
    if (roomEngine) {
      await roomEngine.join(this.roomSocket(server, attachment));
      this.joined.add(connectionId);
      this.scheduleAlarm();
      return;
    }
    await this.withEndpoint(channelPath, async (endpoint) => {
      await endpoint.onConnect?.({ connectionId, userId, roomIds: [roomId] });
    });
  }

  /**
   * Watchdog entry point, invoked by the Durable Object runtime. Re-hydrates
   * any sockets the in-memory engine forgot (after an isolate reset) — which
   * restarts the tick loop — then re-arms itself while the room still holds
   * sockets. Never throws: a throwing alarm would be retried in a hot loop.
   */
  async alarm(): Promise<void> {
    this.alarmScheduled = false;
    try {
      await this.ensureStarted();
      await this.rehydrate();
    } catch (error) {
      this.safeLog("error", "Error in room watchdog alarm", error);
    }
    if (this.ctx.getWebSockets().length > 0) this.scheduleAlarm();
  }

  /**
   * Re-join every hibernation socket the engine does not currently know about.
   * `RoomEngine.join` restarts the tick loop, so this is what brings a room
   * back to life after its isolate was reset. The room *state* is not restored
   * (in-memory state cannot survive eviction) — connectivity and the loop are.
   */
  protected async rehydrate(): Promise<void> {
    for (const ws of this.ctx.getWebSockets()) {
      const att = ws.deserializeAttachment() as WsAttachment | null;
      if (!att) continue;
      const roomEngine = await this.getRoomEngine(att.channelPath, att.roomId);
      if (roomEngine && !this.joined.has(att.connectionId)) {
        await roomEngine.join(this.roomSocket(ws, att));
        this.joined.add(att.connectionId);
      }
    }
  }

  /** Arm the watchdog alarm, unless storage is unavailable or one is pending. */
  protected scheduleAlarm(): void {
    if (this.alarmScheduled || !this.ctx.storage) return;
    this.alarmScheduled = true;
    void this.ctx.storage.setAlarm(this.clock.now() + ALARM_INTERVAL_MS);
  }

  /**
   * Hibernation-API message entry point, invoked by the Durable Object
   * wrapper for every inbound client frame.
   */
  async webSocketMessage(ws: any, data: string | ArrayBuffer): Promise<void> {
    // `webSocketClose` already null-checks this; without the same guard here a
    // frame arriving on a socket whose attachment is gone crashed with 1011.
    const att = ws.deserializeAttachment() as WsAttachment | null;
    if (!att) {
      return;
    }
    const raw =
      typeof data === "string" ? data : new TextDecoder().decode(data);

    const roomEngine = await this.getRoomEngine(att.channelPath, att.roomId);
    if (roomEngine) {
      // Rehydrate after an isolate reset: re-join the socket the engine forgot.
      if (!this.joined.has(att.connectionId)) {
        await roomEngine.join(this.roomSocket(ws, att));
        this.joined.add(att.connectionId);
      }
      let parsed: any;
      try {
        parsed = JSON.parse(raw);
      } catch {
        this.safeLog(
          "warn",
          `Received non-JSON room message on ${att.connectionId}`,
        );
        return;
      }
      await roomEngine.message(att.connectionId, parsed?.message ?? parsed);
      return;
    }

    await this.handleRawMessage(ws, att, raw);
  }

  /**
   * Hibernation-API close entry point, invoked by the Durable Object wrapper
   * when a client socket disconnects.
   */
  async webSocketClose(ws: any): Promise<void> {
    const att = ws.deserializeAttachment() as WsAttachment | null;
    if (!att) return;

    const roomEngine = await this.getRoomEngine(att.channelPath, att.roomId);
    if (roomEngine) {
      await roomEngine.leave(att.connectionId);
      this.joined.delete(att.connectionId);
      this.dataBags.delete(att.connectionId);
      if (roomEngine.size === 0) {
        this.roomEngines.delete(`${att.channelPath}:${att.roomId}`);
      }
      return;
    }

    await this.withEndpoint(att.channelPath, async (endpoint) => {
      await endpoint.onDisconnect?.({
        connectionId: att.connectionId,
        userId: att.userId,
        roomIds: [att.roomId],
      });
    });
  }

  /**
   * RPC invoked by the Cloudflare provider to run a server-side room method
   * (the coordinator/presence seam). The channel/room come as arguments because
   * an RPC — unlike an upgrade — carries no headers.
   */
  async callRoom(
    channelPath: string,
    roomId: string,
    method: string,
    args: unknown[] = [],
  ): Promise<unknown> {
    const roomEngine = await this.getRoomEngine(channelPath, roomId);
    if (!roomEngine) {
      throw new AlephaError(
        `No room endpoint registered for channel '${channelPath}'.`,
      );
    }
    return roomEngine.call(method, args);
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
   *
   * Mirrors `NodeWebSocketConnection.handleMessage`'s error handling so both
   * providers behave the same way from the client's point of view: malformed
   * JSON is logged and dropped, and any error thrown by schema validation or
   * the user's handler is logged, reported back to the offending socket on a
   * best-effort basis, and swallowed — never rethrown. On real Durable Object
   * hibernation, an uncaught throw out of `webSocketMessage` closes the
   * socket with code 1011 and no client-visible reason, so this connection
   * must stay open through handler errors the same way the Node path does.
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
        this.safeLog(
          "warn",
          `Received non-JSON WebSocket message on ${att.connectionId}`,
        );
        return;
      }
      const message = parsed.message ?? parsed;

      try {
        this.getAlepha()
          .inject(SchemaValidator)
          .validate(endpoint.channel.options.schema.out, message);

        const reply = async (opts: {
          message: unknown;
          roomId?: string;
          exceptSelf?: boolean;
          exceptConnectionIds?: string[];
        }) => {
          this.assertReplyRoom(opts.roomId, att.roomId);
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
      } catch (error) {
        this.safeLog(
          "error",
          `Error handling WebSocket message on ${att.connectionId}:`,
          error,
        );
        try {
          ws.send(
            JSON.stringify({
              error: error instanceof Error ? error.message : "Unknown error",
            }),
          );
        } catch {
          // socket may already be closing/closed — nothing more we can do
        }
      }
    });
  }

  /**
   * Guard for `reply({ roomId })` on Cloudflare. `reply()` always fans out
   * over THIS Durable Object's own room (see `broadcastLocal`) — there is no
   * cross-DO hop like the Node provider's `$topic` bus has. So a handler
   * that requests a *different* room's id would otherwise be silently
   * ignored and the message would land in the sender's own room instead of
   * the one it asked for. Fail loud instead of letting that mismatch pass
   * unnoticed.
   *
   * No-ops when `optsRoomId` is `undefined`/`null` (the common case: no
   * explicit room requested) or equal to the connection's own room.
   */
  protected assertReplyRoom(
    optsRoomId: string | undefined,
    attRoomId: string,
  ): void {
    if (optsRoomId != null && optsRoomId !== attRoomId) {
      throw new AlephaError(
        `Cloudflare WebSocket provider: reply() cannot target a different room (roomId '${optsRoomId}' != connection room '${attRoomId}'); cross-room targeting is not supported — use the same room or emit() from a server handler.`,
      );
    }
  }

  /**
   * Send a message to every socket held by this Durable Object, skipping
   * excepted connection ids.
   */
  protected broadcastLocal(message: unknown, except: Set<string>): void {
    const serialized =
      typeof message === "string" ? message : JSON.stringify(message);

    // Stamp the room the same way the Node provider does, so a client
    // dispatches by room on both runtimes. Pre-serialized string payloads are
    // passed through untouched.
    const serializedByRoom = new Map<string, string>();
    const forRoom = (roomId: string | undefined): string => {
      if (!roomId || typeof message === "string") {
        return serialized;
      }

      let labelled = serializedByRoom.get(roomId);
      if (!labelled) {
        labelled = JSON.stringify({
          ...(message as Record<string, unknown>),
          [WebSocketChannelConnection.ROOM_MARKER]: roomId,
        });
        serializedByRoom.set(roomId, labelled);
      }
      return labelled;
    };

    for (const ws of this.ctx.getWebSockets()) {
      const att = ws.deserializeAttachment() as WsAttachment | null;
      if (att && except.has(att.connectionId)) continue;
      try {
        ws.send(forRoom(att?.roomId));
      } catch (error) {
        this.safeLog(
          "warn",
          `Failed to send to WebSocket ${att?.connectionId ?? "unknown"}:`,
          error,
        );
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
   * Best-effort structured log via the app logger (`Alepha.log`). Never
   * throws: if no Alepha instance is available yet — `broadcastLocal` can be
   * reached from the public `broadcast()` RPC before any socket has ever
   * called `withEndpoint` in this isolate — this silently no-ops rather than
   * crashing the caller over a logging convenience.
   */
  protected safeLog(
    level: "warn" | "error",
    message: string,
    data?: unknown,
  ): void {
    try {
      this.getAlepha().log?.[level]?.(message, data);
    } catch {
      // no Alepha instance available yet — nothing to log to
    }
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
    const alepha = await this.ensureStarted();
    const endpoint = alepha
      .inject(WebSocketServerProvider)
      .getEndpoint(channelPath);
    if (endpoint) await fn(endpoint);
  }

  /**
   * Boot the shared app graph on first use (binding this Durable Object's env).
   * Idempotent and re-entrant, so cold-start safe.
   */
  protected async ensureStarted(): Promise<Alepha> {
    const alepha = this.getAlepha();
    if (!this.started) {
      alepha.set("cloudflare.env", this.env);
      alepha.loadEnv(this.env);
      await alepha.start();
      this.started = true;
    }
    return alepha;
  }

  /**
   * Get or create the {@link RoomEngine} for one `channelPath:roomId`, or
   * `undefined` if that channel is a stateless `$websocket` rather than a
   * stateful `$room`. The engine validates client frames against the channel
   * `out` schema and ticks off this Durable Object's own clock.
   */
  protected async getRoomEngine(
    channelPath: string,
    roomId: string,
  ): Promise<RoomEngine<any, any, any> | undefined> {
    const key = `${channelPath}:${roomId}`;
    const existing = this.roomEngines.get(key);
    if (existing) return existing;

    const alepha = await this.ensureStarted();
    const endpoint = alepha
      .inject(WebSocketServerProvider)
      .getRoomEndpoint(channelPath) as
      | RoomPrimitiveOptions<any, any, any>
      | undefined;
    if (!endpoint) return undefined;

    const validator = alepha.inject(SchemaValidator);
    const outSchema = endpoint.channel.options.schema.out;
    const engine = new RoomEngine({
      roomId,
      clock: this.clock,
      options: endpoint,
      validate: (message) => validator.validate(outSchema, message),
      log: (level, message, data) => this.safeLog(level, message, data),
    });
    this.roomEngines.set(key, engine);
    return engine;
  }

  /**
   * Adapt one hibernation WebSocket into a {@link RoomSocket}. The per-
   * connection data bag is held in-memory keyed by connectionId — it survives
   * for as long as the isolate stays warm (an actively-ticking room never
   * hibernates), and is rebuilt on an explicit rehydrate after an isolate
   * reset.
   */
  protected roomSocket(ws: any, att: WsAttachment): RoomSocket {
    let data = this.dataBags.get(att.connectionId);
    if (!data) {
      data = {};
      this.dataBags.set(att.connectionId, data);
    }
    return {
      id: att.connectionId,
      userId: att.userId,
      query: att.query,
      data,
      sendRaw: (payload) => {
        try {
          ws.send(payload);
        } catch (error) {
          this.safeLog("warn", `Failed to send to ${att.connectionId}`, error);
        }
      },
      close: (code, reason) => {
        try {
          ws.close(code, reason);
        } catch {
          // socket may already be closing/closed
        }
      },
    };
  }
}
