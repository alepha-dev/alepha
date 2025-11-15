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
import {
  WebSocketConnectionError,
  WebSocketValidationError,
} from "../errors/WebSocketError.ts";
import type {
  WebSocketConfig,
  WebSocketConnection,
  WebSocketHandlerContext,
} from "../interfaces/WebSocketConnection.ts";
import { WebSocketState } from "../interfaces/WebSocketConnection.ts";
import { WebSocketServerProvider } from "./WebSocketServerProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

const envSchema = t.object({
  WEBSOCKET_URL: t.text({
    default: "",
    description:
      "WebSocket server URL (e.g., ws://localhost:3001). Leave empty to auto-detect.",
  }),
  WEBSOCKET_RECONNECT_INTERVAL: t.int({
    default: 3000,
    description: "Reconnection interval in milliseconds",
  }),
  WEBSOCKET_MAX_RECONNECT_ATTEMPTS: t.int({
    default: 10,
    description:
      "Maximum number of reconnection attempts. Set to -1 for infinite.",
  }),
});

declare module "@alepha/core" {
  interface Env extends Partial<Static<typeof envSchema>> {}
}

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Browser WebSocket client provider
 *
 * Manages WebSocket connections in the browser using the native WebSocket API.
 * Provides automatic reconnection, message queuing, and type-safe handlers.
 */
export class BrowserWebSocketProvider extends WebSocketServerProvider {
  protected readonly alepha = $inject(Alepha);
  protected readonly log = $logger();
  protected readonly env = $env(envSchema);

  protected endpoints = new Map<string, WebSocketConfig<any>>();
  protected clients = new Map<string, WebSocketConnection>();

  // -------------------------------------------------------------------------------------------------------------------

  public registerEndpoint<TMessageSchema extends TSchema>(
    config: WebSocketConfig<TMessageSchema>,
  ): void {
    this.log.debug(`Registering WebSocket client: ${config.path}`);
    this.endpoints.set(config.path, config);
  }

  public getConnections(): WebSocketConnection[] {
    return Array.from(this.clients.values()).filter(
      (client) => client.readyState === WebSocketState.OPEN,
    );
  }

  public async broadcast(message: any): Promise<void> {
    await Promise.all(
      Array.from(this.clients.values()).map((client) => client.send(message)),
    );
  }

  public async sendTo(connectionId: string, message: any): Promise<void> {
    const client = this.clients.get(connectionId);
    if (!client) {
      this.log.warn(`WebSocket client not found: ${connectionId}`);
      return;
    }
    await client.send(message);
  }

  public async closeConnection(
    connectionId: string,
    code?: number,
    reason?: string,
  ): Promise<void> {
    const client = this.clients.get(connectionId);
    if (!client) {
      this.log.warn(`WebSocket client not found: ${connectionId}`);
      return;
    }
    await client.close(code, reason);
  }

  /**
   * Get or create a WebSocket client for a specific path
   */
  public getClient(path: string): WebSocketConnection | undefined {
    return this.clients.get(path);
  }

  /**
   * Connect to a WebSocket endpoint
   */
  public async connect(path: string): Promise<WebSocketConnection> {
    const endpoint = this.endpoints.get(path);
    if (!endpoint) {
      throw new Error(`No WebSocket endpoint registered for path: ${path}`);
    }

    let client = this.clients.get(path);
    if (client) {
      if (client.readyState === WebSocketState.OPEN) {
        return client;
      }
      // Clean up old client
      await client.close();
    }

    const url = this.buildUrl(path);
    client = this.alepha.inject(BrowserWebSocketClient, {
      lifetime: "transient",
      args: [path, url, this, endpoint],
    });
    this.clients.set(path, client);

    await (client as BrowserWebSocketClient).connect();
    return client;
  }

  // -------------------------------------------------------------------------------------------------------------------

  protected buildUrl(path: string): string {
    if (this.env.WEBSOCKET_URL) {
      return `${this.env.WEBSOCKET_URL}${path}`;
    }

    // Auto-detect URL from current location
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const host = window.location.host;
    return `${protocol}//${host}${path}`;
  }

  // -------------------------------------------------------------------------------------------------------------------

  protected readonly ready = $hook({
    on: "ready",
    handler: async () => {
      this.log.debug("Browser WebSocket provider initialized", {
        endpoints: Array.from(this.endpoints.keys()),
      });
    },
  });

  protected readonly stop = $hook({
    on: "stop",
    handler: async () => {
      // Close all connections
      await Promise.all(
        Array.from(this.clients.values()).map((client) => client.close()),
      );
      this.clients.clear();
      this.log.info("All WebSocket clients closed");
    },
  });
}

// ---------------------------------------------------------------------------------------------------------------------

export class BrowserWebSocketClient implements WebSocketConnection {
  protected readonly log = $logger();
  protected readonly alepha = $inject(Alepha);
  public metadata?: Record<string, any>;

  protected ws?: WebSocket;
  protected reconnectAttempts = 0;
  protected reconnectTimer?: number;
  protected messageQueue: any[] = [];

  constructor(
    public readonly id: string,
    protected readonly url: string,
    protected readonly provider: BrowserWebSocketProvider,
    protected readonly endpoint: WebSocketConfig<any>,
  ) {}

  protected get env() {
    return this.alepha.env;
  }

  public get readyState(): WebSocketState {
    return (this.ws?.readyState ?? WebSocketState.CLOSED) as WebSocketState;
  }

  public async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(this.url);

        this.ws.onopen = () => {
          this.log.info(`WebSocket connected: ${this.id}`);
          this.reconnectAttempts = 0;

          // Flush queued messages
          while (this.messageQueue.length > 0) {
            const msg = this.messageQueue.shift();
            this.send(msg).catch((err) => {
              this.log.error("Error sending queued message:", err);
            });
          }

          // Call onConnect handler if provided
          if (this.endpoint.onConnect) {
            Promise.resolve(this.endpoint.onConnect(this)).catch((error) => {
              this.log.error("Error in onConnect handler:", error);
            });
          }

          resolve();
        };

        this.ws.onmessage = async (event) => {
          await this.handleMessage(event.data);
        };

        this.ws.onclose = (event) => {
          this.log.info(`WebSocket closed: ${this.id}`, {
            code: event.code,
            reason: event.reason,
          });

          // Call onDisconnect handler if provided
          if (this.endpoint.onDisconnect) {
            Promise.resolve(this.endpoint.onDisconnect(this)).catch((error) => {
              this.log.error("Error in onDisconnect handler:", error);
            });
          }

          // Attempt reconnection
          this.scheduleReconnect();
        };

        this.ws.onerror = (event) => {
          this.log.error(`WebSocket error on ${this.id}:`, event);
          reject(
            new WebSocketConnectionError(`Failed to connect to ${this.url}`),
          );
        };
      } catch (error) {
        reject(error);
      }
    });
  }

  public async send(message: any): Promise<void> {
    if (this.readyState !== WebSocketState.OPEN) {
      // Queue message for later
      this.messageQueue.push(message);
      return;
    }

    const data =
      typeof message === "string" ? message : JSON.stringify(message);
    this.ws?.send(data);
  }

  public async close(code?: number, reason?: string): Promise<void> {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
    this.ws?.close(code, reason);
  }

  protected scheduleReconnect(): void {
    const maxAttempts = this.env.WEBSOCKET_MAX_RECONNECT_ATTEMPTS ?? 10;
    const reconnectInterval = this.env.WEBSOCKET_RECONNECT_INTERVAL ?? 3000;

    if (maxAttempts !== -1 && this.reconnectAttempts >= maxAttempts) {
      this.log.warn(`Max reconnection attempts reached for ${this.id}`);
      return;
    }

    this.reconnectAttempts++;

    this.reconnectTimer = window.setTimeout(() => {
      this.log.info(
        `Reconnecting ${this.id} (attempt ${this.reconnectAttempts})...`,
      );
      this.connect().catch((error) => {
        this.log.error("Reconnection failed:", error);
      });
    }, reconnectInterval);
  }

  protected async handleMessage(data: any): Promise<void> {
    try {
      let message: any;

      try {
        message = JSON.parse(data);
      } catch {
        message = data;
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
    }
  }
}
