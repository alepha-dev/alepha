import type { IncomingMessage } from "node:http";
import {
  $env,
  $hook,
  $inject,
  Alepha,
  type Static,
  type TSchema,
  TypeBoxValue,
  t,
} from "@alepha/core";
import { $logger } from "@alepha/logger";
import { NodeHttpServerProvider } from "@alepha/server";
import { WebSocket, WebSocketServer } from "ws";
import { WebSocketValidationError } from "../errors/WebSocketError.ts";
import type {
  WebSocketConfig,
  WebSocketConnection,
  WebSocketHandlerContext,
  WebSocketState,
} from "../interfaces/WebSocketConnection.ts";
import { WebSocketServerProvider } from "./WebSocketServerProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

const envSchema = t.object({
  WEBSOCKET_PORT: t.int({
    default: 3001,
    min: 0,
    max: 65535,
    description:
      "WebSocket server port. Set 0 to use the same port as HTTP server.",
  }),
  WEBSOCKET_PATH: t.text({
    default: "/ws",
    description: "Base path for WebSocket endpoints",
  }),
});

declare module "@alepha/core" {
  interface Env extends Partial<Static<typeof envSchema>> {}
}

// ---------------------------------------------------------------------------------------------------------------------

export class NodeWebSocketServerProvider extends WebSocketServerProvider {
  protected readonly alepha = $inject(Alepha);
  protected readonly httpServerProvider = $inject(NodeHttpServerProvider);
  protected readonly log = $logger();
  protected readonly env = $env(envSchema);

  protected wss?: WebSocketServer;
  protected endpoints = new Map<string, WebSocketConfig<any>>();
  protected connections = new Map<string, WebSocketConnection>();
  protected nextConnectionId = 1;

  // -------------------------------------------------------------------------------------------------------------------

  public registerEndpoint<TMessageSchema extends TSchema>(
    config: WebSocketConfig<TMessageSchema>,
  ): void {
    const path = this.normalizePath(config.path);
    this.log.debug(`Registering WebSocket endpoint: ${path}`);
    this.endpoints.set(path, config);
  }

  public getConnections(): WebSocketConnection[] {
    return Array.from(this.connections.values());
  }

  public async broadcast(message: any): Promise<void> {
    const serialized = JSON.stringify(message);
    await Promise.all(
      Array.from(this.connections.values()).map((conn) =>
        conn.send(serialized),
      ),
    );
  }

  public async sendTo(connectionId: string, message: any): Promise<void> {
    const connection = this.connections.get(connectionId);
    if (!connection) {
      this.log.warn(`Connection not found: ${connectionId}`);
      return;
    }
    await connection.send(message);
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

  protected normalizePath(path: string): string {
    const base = this.env.WEBSOCKET_PATH;
    if (path.startsWith(base)) {
      return path;
    }
    return `${base}${path.startsWith("/") ? path : `/${path}`}`;
  }

  protected handleUpgrade(
    request: IncomingMessage,
    socket: any,
    head: Buffer,
  ): void {
    const url = new URL(request.url || "/", "http://localhost");
    const path = url.pathname;

    this.log.debug(`WebSocket upgrade request: ${path}`);

    const endpoint = this.endpoints.get(path);
    if (!endpoint) {
      this.log.warn(`No WebSocket endpoint found for path: ${path}`);
      socket.destroy();
      return;
    }

    this.wss?.handleUpgrade(request, socket, head, (ws) => {
      this.handleConnection(ws, endpoint, request);
    });
  }

  protected handleConnection(
    ws: WebSocket,
    endpoint: WebSocketConfig<any>,
    request: IncomingMessage,
  ): void {
    const connectionId = `ws-${this.nextConnectionId++}`;
    const connection = this.alepha.inject(NodeWebSocketConnection, {
      lifetime: "transient",
      args: [connectionId, ws, this, endpoint],
    });

    this.connections.set(connectionId, connection);

    this.log.info(`WebSocket connection established: ${connectionId}`, {
      path: endpoint.path,
      remoteAddress: request.socket.remoteAddress,
    });

    // Call onConnect handler if provided
    if (endpoint.onConnect) {
      Promise.resolve(endpoint.onConnect(connection)).catch((error) => {
        this.log.error("Error in onConnect handler:", error);
      });
    }

    ws.on("message", async (data) => {
      await connection.handleMessage(data);
    });

    ws.on("close", (code, reason) => {
      this.log.info(`WebSocket connection closed: ${connectionId}`, {
        code,
        reason: reason.toString(),
      });
      this.connections.delete(connectionId);

      // Call onDisconnect handler if provided
      if (endpoint.onDisconnect) {
        Promise.resolve(endpoint.onDisconnect(connection)).catch((error) => {
          this.log.error("Error in onDisconnect handler:", error);
        });
      }
    });

    ws.on("error", (error) => {
      this.log.error(`WebSocket error on ${connectionId}:`, error);
    });
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

      // Attach upgrade handler to the HTTP server
      const httpServer = this.httpServerProvider.server;
      if (httpServer) {
        httpServer.on("upgrade", (request, socket, head) => {
          this.handleUpgrade(request, socket, head);
        });
        this.log.debug("WebSocket upgrade handler attached to HTTP server");
      }

      this.log.info("WebSocket server initialized", {
        basePath: this.env.WEBSOCKET_PATH,
        endpoints: Array.from(this.endpoints.keys()),
      });
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
    protected readonly ws: WebSocket,
    protected readonly provider: NodeWebSocketServerProvider,
    protected readonly endpoint: WebSocketConfig<any>,
  ) {}

  public get readyState(): WebSocketState {
    return this.ws.readyState;
  }

  public async send(message: any): Promise<void> {
    if (this.ws.readyState !== WebSocket.OPEN) {
      throw new Error("WebSocket is not open");
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
      let message: any;

      try {
        message = JSON.parse(rawMessage);
      } catch {
        message = rawMessage;
      }

      // Validate message if schema is provided
      if (this.endpoint.schema?.message) {
        if (!TypeBoxValue.Check(this.endpoint.schema.message, message)) {
          const errors = Array.from(
            TypeBoxValue.Errors(this.endpoint.schema.message, message),
          );
          throw new WebSocketValidationError(
            `Message validation failed: ${errors.map((e: any) => e.message).join(", ")}`,
          );
        }
      }

      const context: WebSocketHandlerContext<any> = {
        message,
        connection: this,
        broadcast: (msg) => this.provider.broadcast(msg),
        sendTo: (connId, msg) => this.provider.sendTo(connId, msg),
        getConnections: () => this.provider.getConnections(),
      };

      await this.endpoint.handler(context);
    } catch (error) {
      this.log.error(`Error handling WebSocket message on ${this.id}:`, error);

      // Send error back to client
      await this.send({
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }
}
