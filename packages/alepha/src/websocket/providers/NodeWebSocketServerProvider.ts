import type { IncomingMessage } from "node:http";
import {
  $atom,
  $hook,
  $inject,
  $use,
  Alepha,
  AlephaError,
  type Static,
  t,
  Value,
} from "alepha";
import { $logger } from "alepha/logger";
import { WebSocket, WebSocketServer } from "ws";
import { WebSocketValidationError } from "../errors/WebSocketError.ts";
import type {
  EmitOptions,
  WebSocketConnection,
  WebSocketHandlerContext,
  WebSocketPrimitiveOptions,
  WebSocketState,
} from "../interfaces/WebSocketInterfaces.ts";
import type { TWSObject } from "../primitives/$channel.ts";
import { RoomManager } from "../services/RoomManager.ts";
import { WebSocketTopicService } from "../services/WebSocketTopicService.ts";
import { WebSocketServerProvider } from "./WebSocketServerProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * WebSocket configuration atom.
 */
export const websocketOptions = $atom({
  name: "alepha.websocket.options",
  schema: t.object({
    path: t.text({
      default: "/ws",
      description: "Base path for WebSocket endpoints.",
    }),
  }),
  default: {
    path: "/ws",
  },
});

export type WebSocketOptions = Static<typeof websocketOptions.schema>;

declare module "alepha" {
  interface State {
    [websocketOptions.key]: WebSocketOptions;
  }
}

// ---------------------------------------------------------------------------------------------------------------------

export class NodeWebSocketServerProvider extends WebSocketServerProvider {
  protected readonly alepha = $inject(Alepha);
  protected readonly roomManager = $inject(RoomManager);
  protected readonly topicService = $inject(WebSocketTopicService);
  protected readonly log = $logger();
  protected readonly wsOptions = $use(websocketOptions);

  protected wss?: WebSocketServer;
  protected endpoints = new Map<string, WebSocketPrimitiveOptions<any, any>>();
  protected connections = new Map<string, WebSocketConnection>();
  protected userConnections = new Map<string, Set<string>>(); // userId → Set<connectionId>
  protected nextConnectionId = 1;

  // -------------------------------------------------------------------------------------------------------------------

  public registerEndpoint<TClient extends TWSObject, TServer extends TWSObject>(
    config: WebSocketPrimitiveOptions<TClient, TServer>,
  ): void {
    const path = config.channel.options.path;
    this.endpoints.set(path, config);
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

  protected handleUpgrade(
    request: IncomingMessage,
    socket: any,
    head: Buffer,
  ): boolean {
    const url = new URL(request.url || "/", "http://localhost");
    const path = url.pathname;

    const endpoint = this.endpoints.get(path);
    if (!endpoint) {
      // Not our endpoint - in Vite dev mode, let Vite HMR handle it
      // In production, destroy the socket
      if (!this.alepha.isViteDev()) {
        this.log.warn(`No WebSocket endpoint found for path: ${path}`);
        socket.destroy();
      }
      return false;
    }

    this.log.debug(`WebSocket upgrade request: ${path}`);

    this.wss?.handleUpgrade(request, socket, head, (ws) => {
      this.handleConnection(ws, endpoint, request);
    });

    return true;
  }

  protected handleConnection<
    TClient extends TWSObject,
    TServer extends TWSObject,
  >(
    ws: WebSocket,
    endpoint: WebSocketPrimitiveOptions<TClient, TServer>,
    request: IncomingMessage,
  ): void {
    const connectionId = `ws-${this.nextConnectionId++}`;

    // TODO: Extract userId from security context when alepha/security is available
    const userId: string | undefined = undefined;

    // Extract roomIds from query params (e.g., ?roomId=room1&roomId=room2 or ?roomIds=room1,room2)
    const url = new URL(request.url || "/", "http://localhost");
    const roomIds = this.extractRoomIds(url);

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

    // Call onConnect handler if provided
    if (endpoint.onConnect) {
      Promise.resolve(
        endpoint.onConnect({ connectionId, userId, roomIds }),
      ).catch((error) => {
        this.log.error("Error in onConnect handler:", error);
      });
    }

    ws.on("message", (data) => {
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

    // Collect target connections based on criteria
    if (criteria.roomIds) {
      for (const roomId of criteria.roomIds) {
        const roomConns = this.roomManager.getRoomConnections(roomId);
        for (const connId of roomConns) {
          targetConnections.add(connId);
        }
      }
    }

    if (criteria.userIds) {
      for (const userId of criteria.userIds) {
        const userConns = this.userConnections.get(userId);
        if (userConns) {
          for (const connId of userConns) {
            targetConnections.add(connId);
          }
        }
      }
    }

    if (criteria.connectionIds) {
      for (const connId of criteria.connectionIds) {
        targetConnections.add(connId);
      }
    }

    // If no specific targeting, send to all connections on this channel
    if (!criteria.roomIds && !criteria.userIds && !criteria.connectionIds) {
      for (const conn of this.connections.values()) {
        targetConnections.add(conn.id);
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

    // Send to all target connections
    const serialized = JSON.stringify(message);
    await Promise.all(
      Array.from(targetConnections).map(async (connId) => {
        const conn = this.connections.get(connId);
        if (conn) {
          try {
            await conn.send(serialized);
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

      this.wss = new WebSocketServer({ noServer: true });

      for (const [path, endpoint] of this.endpoints.entries()) {
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

      // Attach upgrade handler to the HTTP server (must be done after HTTP server starts)
      const httpServer = this.alepha.store.get("alepha.node.server");
      if (httpServer) {
        httpServer.on("upgrade", (request, socket, head) => {
          this.handleUpgrade(request, socket, head);
        });
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

      // Close all connections
      for (const connection of this.connections.values()) {
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
  public metadata?: Record<string, any>;

  constructor(
    public readonly id: string,
    public readonly userId: string | undefined,
    public readonly roomIds: string[],
    protected readonly ws: WebSocket,
    protected readonly provider: NodeWebSocketServerProvider,
    protected readonly endpoint: WebSocketPrimitiveOptions<any, any>,
  ) {}

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

      // Extract roomId from message (or use first room in connection's rooms)
      const roomId = parsed.roomId || this.roomIds[0] || "default";

      // Extract message payload
      const message = parsed.message || parsed;

      // Validate message against schema (out = client→server)
      const outSchema = this.endpoint.channel.options.schema.out;
      if (!Value.Check(outSchema, message)) {
        const errors = Array.from(Value.Errors(outSchema, message));
        throw new WebSocketValidationError(
          `Message validation failed: ${errors.map((e: any) => e.message).join(", ")}`,
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
        const exceptConnectionIds = options.exceptConnectionIds || [];

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
