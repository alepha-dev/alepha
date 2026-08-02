import { randomUUID } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { $hook, $inject, $store, AlephaError, SchemaValidator } from "alepha";
import { $logger } from "alepha/logger";
import { WebSocket, WebSocketServer } from "ws";
import { WebSocketValidationError } from "../errors/WebSocketError.ts";
import type {
  RoomClock,
  RoomPrimitiveOptions,
  RoomSocket,
} from "../interfaces/RoomInterfaces.ts";
import type {
  EmitOptions,
  WebSocketConnection,
  WebSocketHandlerContext,
  WebSocketPrimitiveOptions,
  WebSocketState,
} from "../interfaces/WebSocketInterfaces.ts";
import type { TWSObject } from "../primitives/$channel.ts";
import { RoomManager } from "../services/RoomManager.ts";
import { WebSocketChannelConnection } from "../services/WebSocketClient.ts";
import { WebSocketTopicService } from "../services/WebSocketTopicService.ts";
import { websocketOptions } from "../websocketOptions.ts";
import { RoomEngine } from "./RoomEngine.ts";
import { WebSocketServerProvider } from "./WebSocketServerProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

export class NodeWebSocketServerProvider extends WebSocketServerProvider {
  protected readonly roomManager = $inject(RoomManager);
  protected readonly topicService = $inject(WebSocketTopicService);
  protected readonly schemaValidator = $inject(SchemaValidator);
  protected readonly log = $logger();
  protected readonly wsOptions = $store(websocketOptions);

  protected wss?: WebSocketServer;
  protected endpoints = new Map<string, WebSocketPrimitiveOptions<any, any>>();
  protected connections = new Map<string, WebSocketConnection>();
  protected userConnections = new Map<string, Set<string>>(); // userId → Set<connectionId>
  /**
   * Connection ids must be unique across ALL instances: `emit()` distributes
   * connectionIds/exceptConnectionIds over the topic bus and every instance
   * matches them against its local connections. A per-process counter makes
   * instance B's `ws-1` answer to messages addressed to instance A's `ws-1`
   * (and `exceptSelf` exclude the wrong sockets everywhere). The Cloudflare
   * path already uses randomUUID.
   */
  protected createConnectionId(): string {
    return `ws-${randomUUID()}`;
  }

  /** Registered `$room` endpoints, keyed by channel path. */
  protected roomEndpoints = new Map<
    string,
    RoomPrimitiveOptions<any, any, any>
  >();
  /** Live room engines, keyed by `channelPath:roomId`. */
  protected roomEngines = new Map<string, RoomEngine<any, any, any>>();
  /** Last time each engine was touched, for idle eviction. */
  protected roomEngineTouched = new Map<string, number>();
  /**
   * How long a socket-less room engine may sit idle before it is disposed.
   *
   * Engines are only removed on the socket-close path, so a HEADLESS room —
   * one reached solely through `call()` — was never collected: every distinct
   * roomId ever called accumulated for the life of the process, which for an
   * id-per-user pattern is unbounded. Sweeping only touches engines with no
   * sockets, so a live room is never disturbed.
   */
  protected static readonly ROOM_IDLE_TTL_MS = 5 * 60_000;
  protected roomSweeper?: ReturnType<typeof setInterval>;
  /**
   * Ping interval. A socket that has not answered a ping by the NEXT tick is
   * terminated.
   *
   * Without this, a half-open TCP connection lingered forever: it kept
   * counting against `maxConnectionsPerUser` (locking the user out of their
   * own account) and held room tick loops alive for a client that was gone.
   */
  protected static readonly HEARTBEAT_MS = 30_000;
  /** Sockets that have not answered the last ping. */
  protected readonly awaitingPong = new WeakSet<WebSocket>();
  /** Every live socket, for the liveness sweep. */
  protected readonly sockets = new Set<WebSocket>();

  /**
   * Ping every socket; terminate the ones that ignored the previous ping.
   */
  protected pingConnections(): void {
    for (const ws of this.sockets) {
      if (this.awaitingPong.has(ws)) {
        this.log.debug("Terminating unresponsive WebSocket");
        this.sockets.delete(ws);
        this.awaitingPong.delete(ws);
        ws.terminate();
        continue;
      }
      this.awaitingPong.add(ws);
      try {
        ws.ping();
      } catch {
        this.sockets.delete(ws);
      }
    }
  }

  /** Track a socket for the liveness sweep. */
  protected trackSocket(ws: WebSocket): void {
    this.sockets.add(ws);
    ws.on("pong", () => this.awaitingPong.delete(ws));
    ws.on("close", () => {
      this.sockets.delete(ws);
      this.awaitingPong.delete(ws);
    });
  }
  /**
   * The HTTP server this provider attached its `upgrade` listener to, and the
   * listener itself — kept so `stop` can detach them. Required in Vite dev
   * mode, where the HTTP server OUTLIVES the Alepha instance: every dev
   * reload builds a fresh provider against the same long-lived Vite server,
   * so a listener that is never removed accumulates once per reload, each
   * stale one racing `wss.handleUpgrade` on a closed WebSocketServer.
   */
  protected attachedUpgradeServer?: {
    on(event: "upgrade", listener: (...args: any[]) => void): unknown;
    removeListener(
      event: "upgrade",
      listener: (...args: any[]) => void,
    ): unknown;
  };
  protected upgradeListener?: (
    request: IncomingMessage,
    socket: any,
    head: Buffer,
  ) => void;

  /**
   * The server to attach the WebSocket `upgrade` listener to. Standalone Node
   * runs own their server (`alepha.node.server`). Under `alepha dev`, Vite
   * owns the HTTP server and Alepha rides it — the same pattern the request
   * middleware uses — so fall back to the Vite dev server's `httpServer`
   * (stored as `alepha.vite.server` by ViteDevServerProvider.loadAlepha,
   * which runs before this ready hook).
   */
  protected resolveUpgradeServer():
    | NodeWebSocketServerProvider["attachedUpgradeServer"]
    | undefined {
    const own = this.alepha.store.get("alepha.node.server");
    if (own) return own;
    const vite = this.alepha.store.get("alepha.vite.server" as any) as
      | {
          httpServer?:
            | NodeWebSocketServerProvider["attachedUpgradeServer"]
            | null;
        }
      | undefined;
    return vite?.httpServer ?? undefined;
  }

  /** Real timers for the room tick loop. */
  protected readonly roomClock: RoomClock = {
    setInterval: (fn, ms) => setInterval(fn, ms),
    clearInterval: (handle) =>
      clearInterval(handle as ReturnType<typeof setInterval>),
    now: () => Date.now(),
  };

  // -------------------------------------------------------------------------------------------------------------------

  public registerEndpoint<TClient extends TWSObject, TServer extends TWSObject>(
    config: WebSocketPrimitiveOptions<TClient, TServer>,
  ): void {
    const path = config.channel.options.path;
    this.endpoints.set(path, config);
  }

  /**
   * Look up a registered endpoint by its channel path.
   */
  public getEndpoint(
    channelPath: string,
  ): WebSocketPrimitiveOptions<any, any> | undefined {
    return this.endpoints.get(channelPath);
  }

  public async emit<TClient extends TWSObject>(
    channelPath: string,
    options: EmitOptions<TClient>,
  ): Promise<void> {
    // Publish to topic so all server instances receive it
    await this.topicService.publish({
      channelPath,
      roomIds: options.roomIds
        ? options.roomIds
        : options.roomId
          ? [options.roomId]
          : undefined,
      userIds: options.userIds
        ? options.userIds
        : options.userId
          ? [options.userId]
          : undefined,
      connectionIds: options.connectionIds
        ? options.connectionIds
        : options.connectionId
          ? [options.connectionId]
          : undefined,
      exceptConnectionIds: options.exceptConnectionIds,
      exceptUserIds: options.exceptUserIds,
      message: options.message,
    });
  }

  public getConnections(): WebSocketConnection[] {
    return Array.from(this.connections.values());
  }

  public getRoomConnections(roomId: string): WebSocketConnection[] {
    const connectionIds = this.roomManager.getRoomConnections(roomId);
    return connectionIds
      .map((id) => this.connections.get(id))
      .filter((conn): conn is WebSocketConnection => conn !== undefined);
  }

  public getUserConnections(userId: string): WebSocketConnection[] {
    const connectionIds = this.userConnections.get(userId);
    if (!connectionIds) {
      return [];
    }
    return Array.from(connectionIds)
      .map((id) => this.connections.get(id))
      .filter((conn): conn is WebSocketConnection => conn !== undefined);
  }

  public async closeConnection(
    connectionId: string,
    code?: number,
    reason?: string,
  ): Promise<void> {
    const connection = this.connections.get(connectionId);
    if (!connection) {
      this.log.warn(`Connection not found: ${connectionId}`);
      return;
    }
    await connection.close(code, reason);
  }

  // -------------------------------------------------------------------------------------------------------------------
  // Stateful rooms ($room)
  // -------------------------------------------------------------------------------------------------------------------

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
    this.roomEngineTouched.set(
      `${channelPath}:${roomId}`,
      this.roomClock.now(),
    );
    return this.getRoomEngine(channelPath, roomId).call(method, args);
  }

  /**
   * Dispose socket-less room engines that have been idle past the TTL.
   */
  protected sweepIdleRooms(): void {
    const now = this.roomClock.now();
    for (const [key, engine] of this.roomEngines) {
      if (engine.size > 0) {
        continue;
      }
      const touched = this.roomEngineTouched.get(key) ?? 0;
      if (now - touched < NodeWebSocketServerProvider.ROOM_IDLE_TTL_MS) {
        continue;
      }
      this.log.debug(`Evicting idle room engine '${key}'`);
      engine.dispose();
      this.roomEngines.delete(key);
      this.roomEngineTouched.delete(key);
    }
  }

  public async broadcastToRoom(
    channelPath: string,
    roomId: string,
    message: unknown,
    options?: { exceptConnectionIds?: string[] },
  ): Promise<void> {
    this.roomEngines
      .get(`${channelPath}:${roomId}`)
      ?.broadcast(message, options);
  }

  /**
   * Get or create the room engine for one `channelPath:roomId`. The engine
   * validates client frames against the channel `out` schema and drives its
   * tick loop off the real Node clock.
   */
  protected getRoomEngine(
    channelPath: string,
    roomId: string,
  ): RoomEngine<any, any, any> {
    const key = `${channelPath}:${roomId}`;
    const existing = this.roomEngines.get(key);
    if (existing) return existing;

    const endpoint = this.roomEndpoints.get(channelPath);
    if (!endpoint) {
      throw new AlephaError(`No room endpoint registered for ${channelPath}`);
    }
    const outSchema = endpoint.channel.options.schema.out;
    const engine = new RoomEngine({
      roomId,
      clock: this.roomClock,
      options: endpoint,
      validate: (message) => this.schemaValidator.validate(outSchema, message),
      log: (level, message, data) => this.log[level](message, data),
    });
    this.roomEngines.set(key, engine);
    return engine;
  }

  // -------------------------------------------------------------------------------------------------------------------

  protected async handleUpgrade(
    request: IncomingMessage,
    socket: any,
    head: Buffer,
  ): Promise<boolean> {
    const url = new URL(request.url || "/", "http://localhost");
    const path = url.pathname;

    const endpoint = this.endpoints.get(path);
    const roomEndpoint = this.roomEndpoints.get(path);
    if (!endpoint && !roomEndpoint) {
      // Not our endpoint - in Vite dev mode, let Vite HMR handle it
      // In production, destroy the socket
      if (!this.alepha.isViteDev()) {
        this.log.warn(`No WebSocket endpoint found for path: ${path}`);
        socket.destroy();
      }
      return false;
    }

    this.log.debug(`WebSocket upgrade request: ${path}`);

    const secure = endpoint?.secure ?? roomEndpoint?.secure;
    const userId = await this.resolveUserIdFromUpgrade(request);
    if (secure && !userId) {
      this.log.warn(`Rejected unauthenticated WebSocket upgrade: ${path}`);
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return false;
    }

    this.wss?.handleUpgrade(request, socket, head, (ws) => {
      if (roomEndpoint) {
        this.trackSocket(ws);
        this.handleRoomConnection(ws, roomEndpoint, request, userId);
      } else if (endpoint) {
        this.trackSocket(ws);
        this.handleConnection(ws, endpoint, request, userId);
      }
    });

    return true;
  }

  /**
   * Adapt one Node `ws` socket into a {@link RoomSocket} and drive its room
   * engine's join/message/leave lifecycle. The room's tick loop, state and
   * per-recipient send all live in the engine.
   */
  protected handleRoomConnection(
    ws: WebSocket,
    endpoint: RoomPrimitiveOptions<any, any, any>,
    request: IncomingMessage,
    userId: string | undefined,
  ): void {
    const path = endpoint.channel.options.path;
    const connectionId = this.createConnectionId();
    const url = new URL(request.url || "/", "http://localhost");
    const roomId = this.extractRoomIds(url)[0] ?? "default";

    if (userId && endpoint.maxConnectionsPerUser) {
      const existing = this.userConnections.get(userId);
      if (existing && existing.size >= endpoint.maxConnectionsPerUser) {
        this.log.warn(
          `User ${userId} exceeded max connections (${endpoint.maxConnectionsPerUser})`,
        );
        ws.close(1008, "Max connections per user exceeded");
        return;
      }
    }

    const engine = this.getRoomEngine(path, roomId);
    const key = `${path}:${roomId}`;
    const roomSocket: RoomSocket = {
      id: connectionId,
      userId,
      query: Object.fromEntries(url.searchParams),
      data: {},
      sendRaw: (data) => {
        if (ws.readyState === WebSocket.OPEN) ws.send(data);
      },
      close: (code, reason) => ws.close(code, reason),
    };

    if (userId) {
      let userConns = this.userConnections.get(userId);
      if (!userConns) {
        userConns = new Set();
        this.userConnections.set(userId, userConns);
      }
      userConns.add(connectionId);
    }

    // Room sockets belong in the same registry as channel sockets. Without
    // this, `getConnections()` / `getUserConnections()` / `closeConnection()`
    // could not see them, and the stop hook's close-all loop skipped them —
    // `wss.close()` on a `noServer` instance does not close established
    // sockets, so shutdown tore rooms down abruptly (1006) instead of sending
    // a 1001. It is a thin adapter, not a NodeWebSocketConnection: a room
    // socket has no per-channel validation or send pipeline of its own.
    this.connections.set(connectionId, {
      id: connectionId,
      userId,
      channelPath: path,
      roomIds: [roomId],
      send: async (message: unknown) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(
            typeof message === "string" ? message : JSON.stringify(message),
          );
        }
      },
      close: async (code?: number, reason?: string) => {
        ws.close(code, reason);
      },
      get readyState() {
        return ws.readyState as unknown as WebSocketState;
      },
    });

    this.log.info(`WebSocket room connection established: ${connectionId}`, {
      path,
      roomId,
      userId,
      remoteAddress: request.socket.remoteAddress,
    });

    // `join` is async (the room's `state` factory may be), so frames and the
    // close event can arrive before the socket is actually admitted. Gate both
    // on the join promise: without it, a close during an async factory
    // early-returns from `leave()` (socket not in the engine yet) and the
    // later-resolving join admits a ghost that keeps the room non-empty
    // forever — tick loop spinning, `onEmpty` never persisting.
    let closed = false;
    const joined = engine.join(roomSocket).then(
      () => true,
      (error) => {
        this.log.error(`Failed to join room on ${connectionId}:`, error);
        ws.close(1011, "Room join failed");
        return false;
      },
    );

    ws.on("message", (data) => {
      let parsed: any;
      try {
        parsed = JSON.parse(data.toString());
      } catch {
        this.log.warn(`Received non-JSON room message on ${connectionId}`);
        return;
      }
      const message = parsed?.message ?? parsed;
      joined
        .then((ok) => {
          if (!ok || closed) return;
          return engine.message(connectionId, message);
        })
        .catch((error) => {
          this.log.error(
            `Error handling room message on ${connectionId}:`,
            error,
          );
        });
    });

    ws.on("close", (code, reason) => {
      closed = true;
      this.log.info(`WebSocket room connection closed: ${connectionId}`, {
        code,
        reason: reason.toString(),
      });
      this.connections.delete(connectionId);
      if (userId) {
        const userConns = this.userConnections.get(userId);
        if (userConns) {
          userConns.delete(connectionId);
          if (userConns.size === 0) this.userConnections.delete(userId);
        }
      }
      // Wait for the pending join before leaving, so a disconnect that races
      // an async factory still removes the socket.
      joined
        .then(() => engine.leave(connectionId))
        .then(() => {
          if (engine.size === 0) this.roomEngines.delete(key);
        })
        .catch((error) => {
          this.log.error(`Error leaving room on ${connectionId}:`, error);
        });
    });

    ws.on("error", (error) => {
      this.log.error(`WebSocket room error on ${connectionId}:`, error);
    });
  }

  /**
   * Adapt a Node upgrade request into the minimal shape the security resolvers
   * read (url + headers, including cookie), then resolve the user id.
   */
  protected async resolveUserIdFromUpgrade(
    request: IncomingMessage,
  ): Promise<string | undefined> {
    const url = `http://${request.headers.host ?? "localhost"}${request.url ?? "/"}`;
    return this.resolveUserId({
      url,
      headers: {
        authorization: request.headers.authorization,
        cookie: request.headers.cookie,
      },
    });
  }

  /**
   * Warn (dev only) when a single connection is placed in more than one room.
   * On the Cloudflare provider a socket lives in exactly one Durable Object, so
   * multi-room connections are not portable.
   */
  protected warnMultiRoom(roomIds: string[]): void {
    if (roomIds.length > 1 && !this.alepha.isProduction()) {
      this.log.warn(
        `WebSocket connection joined multiple rooms (${roomIds.join(", ")}); ` +
          "this is not portable to the Cloudflare provider (one room per connection).",
      );
    }
  }

  protected handleConnection<
    TClient extends TWSObject,
    TServer extends TWSObject,
  >(
    ws: WebSocket,
    endpoint: WebSocketPrimitiveOptions<TClient, TServer>,
    request: IncomingMessage,
    userId: string | undefined,
  ): void {
    const connectionId = this.createConnectionId();

    // Extract roomIds from query params (e.g., ?roomId=room1&roomId=room2 or ?roomIds=room1,room2)
    const url = new URL(request.url || "/", "http://localhost");
    const roomIds = this.extractRoomIds(url);
    this.warnMultiRoom(roomIds);

    // Check max connections per user before registering
    if (userId && endpoint.maxConnectionsPerUser) {
      const existingConns = this.userConnections.get(userId);
      if (
        existingConns &&
        existingConns.size >= endpoint.maxConnectionsPerUser
      ) {
        this.log.warn(
          `User ${userId} exceeded max connections (${endpoint.maxConnectionsPerUser})`,
        );
        ws.close(1008, "Max connections per user exceeded");
        return;
      }
    }

    const connection = this.alepha.inject(NodeWebSocketConnection, {
      lifetime: "transient",
      args: [connectionId, userId, roomIds, ws, this, endpoint],
    });

    this.connections.set(connectionId, connection);

    // Track user connections
    if (userId) {
      let userConns = this.userConnections.get(userId);
      if (!userConns) {
        userConns = new Set();
        this.userConnections.set(userId, userConns);
      }
      userConns.add(connectionId);
    }

    // Join rooms
    if (roomIds.length > 0) {
      this.roomManager.joinRooms(connectionId, roomIds);
    }

    this.log.info(`WebSocket connection established: ${connectionId}`, {
      path: endpoint.channel.options.path,
      userId,
      roomIds,
      remoteAddress: request.socket.remoteAddress,
    });

    const path = endpoint.channel.options.path;
    this.emitHook("websocket:connect", { connectionId, path });

    // Call onConnect handler if provided
    if (endpoint.onConnect) {
      Promise.resolve(
        endpoint.onConnect({ connectionId, userId, roomIds }),
      ).catch((error) => {
        this.log.error("Error in onConnect handler:", error);
      });
    }

    ws.on("message", (data) => {
      this.emitHook("websocket:message", {
        connectionId,
        path,
        message: data.toString(),
      });
      connection.handleMessage(data).catch((error) => {
        this.log.error(
          `Unhandled error in message handler for ${connectionId}:`,
          error,
        );
      });
    });

    ws.on("close", (code, reason) => {
      this.log.info(`WebSocket connection closed: ${connectionId}`, {
        code,
        reason: reason.toString(),
      });

      // Clean up
      this.connections.delete(connectionId);
      this.roomManager.leaveAllRooms(connectionId);

      if (userId) {
        const userConns = this.userConnections.get(userId);
        if (userConns) {
          userConns.delete(connectionId);
          if (userConns.size === 0) {
            this.userConnections.delete(userId);
          }
        }
      }

      this.emitHook("websocket:disconnect", {
        connectionId,
        path,
        code,
        reason: reason.toString(),
      });

      // Call onDisconnect handler if provided
      if (endpoint.onDisconnect) {
        Promise.resolve(
          endpoint.onDisconnect({ connectionId, userId, roomIds }),
        ).catch((error) => {
          this.log.error("Error in onDisconnect handler:", error);
        });
      }
    });

    ws.on("error", (error) => {
      this.log.error(`WebSocket error on ${connectionId}:`, error);
      this.emitHook("websocket:error", { connectionId, path, error });
    });
  }

  /**
   * Emit a `websocket:*` observability hook. Fire-and-forget: a subscriber
   * must never be able to break the connection it is observing.
   */
  protected emitHook<
    K extends
      | "websocket:connect"
      | "websocket:disconnect"
      | "websocket:message"
      | "websocket:error",
  >(name: K, payload: Parameters<typeof this.alepha.events.emit<K>>[1]): void {
    this.alepha.events.emit(name, payload, { catch: true }).catch((error) => {
      this.log.error(`Error emitting ${name}`, error);
    });
  }

  protected extractRoomIds(url: URL): string[] {
    const roomIds: string[] = [];

    // Check for roomId parameter (can be multiple)
    const roomIdParams = url.searchParams.getAll("roomId");
    roomIds.push(...roomIdParams);

    // Check for roomIds parameter (comma-separated)
    const roomIdsParam = url.searchParams.get("roomIds");
    if (roomIdsParam) {
      roomIds.push(
        ...roomIdsParam
          .split(",")
          .map((id) => id.trim())
          .filter((id) => id.length > 0),
      );
    }

    // Default room if none specified
    if (roomIds.length === 0) {
      roomIds.push("default");
    }

    return roomIds;
  }

  /**
   * Send message to local connections based on targeting criteria
   * This is called by the topic service when a message is received
   */
  protected async sendToLocalConnections(
    channelPath: string,
    message: any,
    criteria: {
      roomIds?: string[];
      userIds?: string[];
      connectionIds?: string[];
      exceptConnectionIds?: string[];
      exceptUserIds?: string[];
    },
  ): Promise<void> {
    const targetConnections = new Set<string>();

    // Which room made a connection a target, so the frame can say so. A client
    // holds ONE socket for every room it subscribed to; without this it cannot
    // tell which of its handlers a message belongs to.
    const targetRooms = new Map<string, string>();

    // Helper to check if a connection belongs to this channel
    const isOnChannel = (connId: string) => {
      const conn = this.connections.get(connId);
      return conn?.channelPath === channelPath;
    };

    // Collect target connections based on criteria
    if (criteria.roomIds) {
      for (const roomId of criteria.roomIds) {
        const roomConns = this.roomManager.getRoomConnections(roomId);
        for (const connId of roomConns) {
          if (isOnChannel(connId)) {
            targetConnections.add(connId);
            // First room wins for a connection in several of the targeted
            // rooms — it receives one frame, so it gets one label.
            if (!targetRooms.has(connId)) {
              targetRooms.set(connId, roomId);
            }
          }
        }
      }
    }

    if (criteria.userIds) {
      for (const userId of criteria.userIds) {
        const userConns = this.userConnections.get(userId);
        if (userConns) {
          for (const connId of userConns) {
            if (isOnChannel(connId)) {
              targetConnections.add(connId);
            }
          }
        }
      }
    }

    if (criteria.connectionIds) {
      for (const connId of criteria.connectionIds) {
        if (isOnChannel(connId)) {
          targetConnections.add(connId);
        }
      }
    }

    // If no specific targeting, send to all connections on this channel
    if (!criteria.roomIds && !criteria.userIds && !criteria.connectionIds) {
      for (const conn of this.connections.values()) {
        if (conn.channelPath === channelPath) {
          targetConnections.add(conn.id);
        }
      }
    }

    // Remove exceptions
    if (criteria.exceptConnectionIds) {
      for (const connId of criteria.exceptConnectionIds) {
        targetConnections.delete(connId);
      }
    }

    if (criteria.exceptUserIds) {
      for (const userId of criteria.exceptUserIds) {
        const userConns = this.userConnections.get(userId);
        if (userConns) {
          for (const connId of userConns) {
            targetConnections.delete(connId);
          }
        }
      }
    }

    // Send to all target connections. Frames addressed to a room carry the
    // room marker; a channel-wide emit stays unlabelled.
    const serializedByRoom = new Map<string, string>();
    const serialize = (roomId: string | undefined): string => {
      if (!roomId) {
        return JSON.stringify(message);
      }

      let serialized = serializedByRoom.get(roomId);
      if (!serialized) {
        serialized = JSON.stringify({
          ...message,
          [WebSocketChannelConnection.ROOM_MARKER]: roomId,
        });
        serializedByRoom.set(roomId, serialized);
      }
      return serialized;
    };

    await Promise.all(
      Array.from(targetConnections).map(async (connId) => {
        const conn = this.connections.get(connId);
        if (conn) {
          try {
            await conn.send(serialize(targetRooms.get(connId)));
          } catch (error) {
            this.log.error(`Failed to send to connection ${connId}:`, error);
          }
        }
      }),
    );
  }

  // -------------------------------------------------------------------------------------------------------------------

  protected readonly start = $hook({
    on: "start",
    handler: async () => {
      if (this.alepha.isServerless()) {
        this.log.debug("WebSocket server disabled in serverless mode");
        return;
      }

      // `maxPayload` is the pre-parse transport backstop (see the atom's docblock above) — every
      // frame over this size is rejected by `ws` itself, before `handleRoomConnection`'s
      // `JSON.parse` or any app-level per-message cap ever sees it.
      this.wss = new WebSocketServer({
        noServer: true,
        maxPayload: this.wsOptions.maxPayload,
      });

      // Idle-room sweep + liveness ping share one timer.
      this.roomSweeper = setInterval(() => {
        this.sweepIdleRooms();
        this.pingConnections();
      }, NodeWebSocketServerProvider.HEARTBEAT_MS);
      this.roomSweeper.unref?.();

      for (const path of this.endpoints.keys()) {
        this.log.debug(`WebSocket endpoint registered: ${path}`);
      }

      // Set up topic service message handler
      this.topicService.setMessageHandler(async (event) => {
        await this.sendToLocalConnections(event.channelPath, event.message, {
          roomIds: event.roomIds,
          userIds: event.userIds,
          connectionIds: event.connectionIds,
          exceptConnectionIds: event.exceptConnectionIds,
          exceptUserIds: event.exceptUserIds,
        });
      });

      this.log.info("WebSocket server OK", {
        basePath: this.wsOptions.path,
      });
    },
  });

  protected readonly ready = $hook({
    on: "ready",
    handler: async () => {
      if (this.alepha.isServerless() || !this.wss) {
        return;
      }

      // Attach upgrade handler to the HTTP server (must be done after HTTP server starts).
      // See resolveUpgradeServer for the Vite-dev fallback, and
      // attachedUpgradeServer for why the listener is kept for detachment.
      const httpServer = this.resolveUpgradeServer();
      if (httpServer) {
        this.upgradeListener = (request, socket, head) => {
          this.handleUpgrade(request, socket, head).catch((error) => {
            this.log.error("Unhandled error during WebSocket upgrade:", error);
            socket.destroy();
          });
        };
        this.attachedUpgradeServer = httpServer;
        httpServer.on("upgrade", this.upgradeListener);
        this.log.debug("WebSocket upgrade handler attached to HTTP server");
      } else {
        this.log.warn(
          "No HTTP server found - WebSocket upgrade handler not attached",
        );
      }
    },
  });

  protected readonly stop = $hook({
    on: "stop",
    handler: async () => {
      if (!this.wss) {
        return;
      }

      if (this.roomSweeper) {
        clearInterval(this.roomSweeper);
        this.roomSweeper = undefined;
      }

      // Detach the upgrade listener: in Vite dev the HTTP server outlives this
      // provider (see attachedUpgradeServer), so leaving it would leak one
      // dead handler per dev reload.
      if (this.attachedUpgradeServer && this.upgradeListener) {
        this.attachedUpgradeServer.removeListener(
          "upgrade",
          this.upgradeListener,
        );
        this.attachedUpgradeServer = undefined;
        this.upgradeListener = undefined;
      }

      // Stop every room tick loop so open timers cannot keep the process alive.
      for (const engine of this.roomEngines.values()) engine.dispose();
      this.roomEngines.clear();
      this.roomEngineTouched.clear();
      this.sockets.clear();

      // Close all connections (collect into array to avoid mutation during iteration)
      const connections = Array.from(this.connections.values());
      for (const connection of connections) {
        await connection.close(1001, "Server shutting down");
      }

      await new Promise<void>((resolve, reject) => {
        this.wss?.close((err) => {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        });
      });

      this.log.info("WebSocket server closed");
    },
  });
}

// ---------------------------------------------------------------------------------------------------------------------

export class NodeWebSocketConnection implements WebSocketConnection {
  protected readonly log = $logger();
  protected readonly schemaValidator = $inject(SchemaValidator);
  public metadata?: Record<string, any>;

  constructor(
    public readonly id: string,
    public readonly userId: string | undefined,
    public readonly roomIds: string[],
    protected readonly ws: WebSocket,
    protected readonly provider: NodeWebSocketServerProvider,
    protected readonly endpoint: WebSocketPrimitiveOptions<any, any>,
  ) {}

  public get channelPath(): string {
    return this.endpoint.channel.options.path;
  }

  public get readyState(): WebSocketState {
    return this.ws.readyState;
  }

  public async send(message: any): Promise<void> {
    if (this.ws.readyState !== WebSocket.OPEN) {
      throw new AlephaError("WebSocket is not open");
    }

    const data =
      typeof message === "string" ? message : JSON.stringify(message);
    await new Promise<void>((resolve, reject) => {
      this.ws.send(data, (err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }

  public async close(code?: number, reason?: string): Promise<void> {
    this.ws.close(code, reason);
  }

  public async handleMessage(data: any): Promise<void> {
    try {
      const rawMessage = data.toString();
      let parsed: any;

      try {
        parsed = JSON.parse(rawMessage);
      } catch {
        this.log.warn("Received non-JSON message");
        return;
      }

      // Extract roomId from message (or use first room in connection's rooms).
      // A frame-level roomId is only honored for rooms this connection
      // actually joined — otherwise a client in room A could address (and
      // broadcast into) any room B per-frame. Cloudflare refuses cross-room
      // replies outright (assertReplyRoom); Node must not be laxer.
      const claimedRoomId = parsed.roomId;
      const defaultRoomId = this.roomIds[0] || "default";
      let roomId = defaultRoomId;
      if (claimedRoomId && claimedRoomId !== defaultRoomId) {
        if (this.roomIds.includes(claimedRoomId)) {
          roomId = claimedRoomId;
        } else {
          this.log.warn(
            `Connection ${this.id} addressed room '${claimedRoomId}' it has not joined — ignoring frame roomId`,
            { joined: this.roomIds },
          );
        }
      }

      // Extract message payload
      const message = parsed.message || parsed;

      // Validate message against schema (out = client→server)
      const outSchema = this.endpoint.channel.options.schema.out;
      try {
        this.schemaValidator.validate(outSchema, message);
      } catch (err) {
        throw new WebSocketValidationError(
          `Message validation failed: ${(err as Error).message}`,
        );
      }

      // Create reply function scoped to this context
      const reply = async (options: {
        message: any;
        roomId?: string;
        exceptSelf?: boolean;
        exceptConnectionIds?: string[];
        exceptUserIds?: string[];
      }) => {
        const targetRoomId = options.roomId || roomId;
        // Copy — `push`ing onto the caller's array mutated it, so a reused
        // options object accumulated a new id on every reply.
        const exceptConnectionIds = [...(options.exceptConnectionIds ?? [])];

        if (options.exceptSelf) {
          exceptConnectionIds.push(this.id);
        }

        await this.provider.emit(this.endpoint.channel.options.path, {
          message: options.message,
          roomId: targetRoomId,
          exceptConnectionIds,
          exceptUserIds: options.exceptUserIds,
        });
      };

      const context: WebSocketHandlerContext<any, any> = {
        connectionId: this.id,
        userId: this.userId,
        roomId,
        message,
        reply,
      };

      await this.endpoint.handler(context);
    } catch (error) {
      this.log.error(`Error handling WebSocket message on ${this.id}:`, error);

      // Send error back to client (best-effort, may not match channel schema)
      try {
        await this.send({
          error: error instanceof Error ? error.message : "Unknown error",
        });
      } catch {
        // Connection may already be closed
      }
    }
  }
}
