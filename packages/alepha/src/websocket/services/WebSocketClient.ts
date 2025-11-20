import { $env, $inject, Alepha, type Static, TypeBoxValue, t } from "alepha";
import { $logger } from "alepha/logger";
import type { ChannelDescriptor, TWSObject } from "../descriptors/$channel.ts";

const envSchema = t.object({
  WEBSOCKET_URL: t.text({
    default: "",
    description:
      "WebSocket server URL (e.g., ws://localhost:3001). Leave empty to auto-detect.",
  }),
  WEBSOCKET_RECONNECT_INTERVAL: t.integer({
    default: 3000,
    description: "Reconnection interval in milliseconds",
  }),
  WEBSOCKET_MAX_RECONNECT_ATTEMPTS: t.integer({
    default: 10,
    description:
      "Maximum number of reconnection attempts. Set to -1 for infinite.",
  }),
});

declare module "alepha" {
  interface Env extends Partial<Static<typeof envSchema>> {}
}

/**
 * Room subscription
 */
interface RoomSubscription<TClient extends TWSObject> {
  roomId: string;
  handler: (message: Static<TClient>) => void;
}

/**
 * WebSocket channel connection
 *
 * Manages a single WebSocket connection to a channel with multiple room subscriptions.
 * One connection can handle multiple rooms on the same channel.
 */
export class WebSocketChannelConnection<
  TClient extends TWSObject,
  TServer extends TWSObject,
> {
  protected readonly log = $logger();
  protected ws?: WebSocket;
  protected reconnectAttempts = 0;
  protected reconnectTimer?: number;
  protected messageQueue: Array<{ roomId: string; message: Static<TServer> }> =
    [];

  // Room subscriptions: Map<roomId, handler>
  protected subscriptions = new Map<
    string,
    (message: Static<TClient>) => void
  >();

  // Connection state
  public isConnected = false;
  public isConnecting = false;
  public isError = false;
  public error?: Error;

  // Connection callbacks
  protected onConnectCallbacks = new Set<() => void>();
  protected onDisconnectCallbacks = new Set<() => void>();
  protected onErrorCallbacks = new Set<(error: Error) => void>();

  constructor(
    protected readonly channel: ChannelDescriptor<TClient, TServer>,
    protected readonly options: {
      url?: string;
      autoReconnect?: boolean;
      reconnectInterval?: number;
      maxReconnectAttempts?: number;
    },
    protected readonly env: Static<typeof envSchema>,
  ) {}

  /**
   * Build WebSocket URL
   */
  protected buildUrl(): string {
    if (this.options.url) {
      return this.options.url;
    }

    // Auto-detect URL from current location (browser only)
    if (typeof window !== "undefined") {
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const host = window.location.host;
      const path = this.channel.options.path;
      // Send all room IDs as query params
      const roomIds = Array.from(this.subscriptions.keys());
      const roomParam =
        roomIds.length > 0 ? `?roomIds=${roomIds.join(",")}` : "";
      return `${protocol}//${host}${path}${roomParam}`;
    }

    // Fallback to env URL
    return `${this.env.WEBSOCKET_URL}${this.channel.options.path}`;
  }

  /**
   * Subscribe to a room on this channel
   */
  public subscribe(
    roomId: string,
    handler: (message: Static<TClient>) => void,
    callbacks?: {
      onConnect?: () => void;
      onDisconnect?: () => void;
      onError?: (error: Error) => void;
    },
  ): () => void {
    // Add subscription
    this.subscriptions.set(roomId, handler);

    // Add callbacks
    if (callbacks?.onConnect) this.onConnectCallbacks.add(callbacks.onConnect);
    if (callbacks?.onDisconnect)
      this.onDisconnectCallbacks.add(callbacks.onDisconnect);
    if (callbacks?.onError) this.onErrorCallbacks.add(callbacks.onError);

    // Connect if not already connected
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.connect().catch((error) => {
        this.log.error("Failed to connect:", error);
      });
    }

    // Return unsubscribe function
    return () => {
      this.subscriptions.delete(roomId);
      if (callbacks?.onConnect)
        this.onConnectCallbacks.delete(callbacks.onConnect);
      if (callbacks?.onDisconnect)
        this.onDisconnectCallbacks.delete(callbacks.onDisconnect);
      if (callbacks?.onError) this.onErrorCallbacks.delete(callbacks.onError);

      // Disconnect if no more subscriptions
      if (this.subscriptions.size === 0) {
        this.disconnect();
      }
    };
  }

  /**
   * Connect to WebSocket server
   */
  protected async connect(): Promise<void> {
    if (this.ws?.readyState === WebSocket.OPEN) {
      return;
    }

    this.isConnecting = true;
    this.isError = false;
    this.error = undefined;

    return new Promise((resolve, reject) => {
      try {
        const ws = new WebSocket(this.buildUrl());
        this.ws = ws;

        ws.onopen = () => {
          this.isConnected = true;
          this.isConnecting = false;
          this.isError = false;
          this.error = undefined;
          this.reconnectAttempts = 0;

          // Flush queued messages
          while (this.messageQueue.length > 0) {
            const msg = this.messageQueue.shift();
            if (msg) {
              ws.send(
                JSON.stringify({
                  roomId: msg.roomId,
                  message: msg.message,
                }),
              );
            }
          }

          // Call all connect callbacks
          for (const callback of this.onConnectCallbacks) {
            callback();
          }

          resolve();
        };

        ws.onmessage = (event) => {
          this.handleMessage(event.data);
        };

        ws.onclose = () => {
          this.isConnected = false;
          this.isConnecting = false;
          this.ws = undefined;

          // Call all disconnect callbacks
          for (const callback of this.onDisconnectCallbacks) {
            callback();
          }

          // Attempt reconnection
          if (this.options.autoReconnect !== false) {
            this.scheduleReconnect();
          }
        };

        ws.onerror = () => {
          const err = new Error("WebSocket connection error");
          this.isError = true;
          this.error = err;
          this.isConnecting = false;

          // Call all error callbacks
          for (const callback of this.onErrorCallbacks) {
            callback(err);
          }

          reject(err);
        };
      } catch (err) {
        const error =
          err instanceof Error ? err : new Error("Connection failed");
        this.isError = true;
        this.error = error;
        this.isConnecting = false;

        // Call all error callbacks
        for (const callback of this.onErrorCallbacks) {
          callback(error);
        }

        reject(error);
      }
    });
  }

  /**
   * Handle incoming message
   */
  protected handleMessage(data: string): void {
    try {
      const parsed = JSON.parse(data);

      // Validate incoming message against schema
      const inSchema = this.channel.options.schema.in;
      if (!TypeBoxValue.Check(inSchema, parsed)) {
        this.log.error("Invalid message schema:", parsed);
        return;
      }

      // Extract roomId from message if present (server should send it back)
      // For now, broadcast to all subscribed rooms
      // TODO: Server should include roomId in response
      for (const handler of this.subscriptions.values()) {
        handler(parsed as Static<TClient>);
      }
    } catch (err) {
      this.log.error("Error handling message:", err);
    }
  }

  /**
   * Send message to a specific room
   */
  public async send(roomId: string, message: Static<TServer>): Promise<void> {
    // Validate outgoing message against schema
    const outSchema = this.channel.options.schema.out;
    if (!TypeBoxValue.Check(outSchema, message)) {
      const errors = Array.from(TypeBoxValue.Errors(outSchema, message));
      throw new Error(
        `Message validation failed: ${errors.map((e) => e.message).join(", ")}`,
      );
    }

    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      // Queue message
      this.messageQueue.push({ roomId, message });
      return;
    }

    this.ws.send(
      JSON.stringify({
        roomId,
        message,
      }),
    );
  }

  /**
   * Schedule reconnection
   */
  protected scheduleReconnect(): void {
    const maxAttempts =
      this.options.maxReconnectAttempts ??
      this.env.WEBSOCKET_MAX_RECONNECT_ATTEMPTS ??
      10;
    const reconnectInterval =
      this.options.reconnectInterval ??
      this.env.WEBSOCKET_RECONNECT_INTERVAL ??
      3000;

    if (maxAttempts !== -1 && this.reconnectAttempts >= maxAttempts) {
      this.log.warn("Max reconnection attempts reached");
      return;
    }

    this.reconnectAttempts++;

    this.reconnectTimer = window.setTimeout(() => {
      this.log.info(`Reconnecting... (attempt ${this.reconnectAttempts})`);
      this.connect().catch((error) => {
        this.log.error("Reconnection failed:", error);
      });
    }, reconnectInterval);
  }

  /**
   * Disconnect from server
   */
  public disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }

    if (this.ws) {
      this.ws.close();
      this.ws = undefined;
    }

    this.isConnected = false;
    this.isConnecting = false;
  }

  /**
   * Reconnect manually
   */
  public reconnect(): void {
    this.disconnect();
    this.connect().catch((error) => {
      this.log.error("Manual reconnection failed:", error);
    });
  }

  /**
   * Check if subscribed to a room
   */
  public hasRoom(roomId: string): boolean {
    return this.subscriptions.has(roomId);
  }

  /**
   * Get all subscribed rooms
   */
  public getRooms(): string[] {
    return Array.from(this.subscriptions.keys());
  }
}

/**
 * WebSocket Client Service
 *
 * Manages WebSocket connections from the client side (browser).
 * One connection per channel, multiple rooms per connection.
 */
export class WebSocketClient {
  protected readonly log = $logger();
  protected readonly alepha = $inject(Alepha);
  protected readonly env = $env(envSchema);

  // Map<channelPath, connection>
  protected connections = new Map<
    string,
    WebSocketChannelConnection<any, any>
  >();

  /**
   * Subscribe to a room on a channel
   */
  public subscribe<TClient extends TWSObject, TServer extends TWSObject>(
    roomId: string,
    channel: ChannelDescriptor<TClient, TServer>,
    handler: (message: Static<TClient>) => void,
    options: {
      url?: string;
      autoReconnect?: boolean;
      reconnectInterval?: number;
      maxReconnectAttempts?: number;
      onConnect?: () => void;
      onDisconnect?: () => void;
      onError?: (error: Error) => void;
    } = {},
  ): () => void {
    const channelPath = channel.options.path;

    // Get or create connection for this channel
    let connection = this.connections.get(
      channelPath,
    ) as WebSocketChannelConnection<TClient, TServer>;

    if (!connection) {
      connection = new WebSocketChannelConnection(
        channel,
        {
          url: options.url,
          autoReconnect: options.autoReconnect,
          reconnectInterval: options.reconnectInterval,
          maxReconnectAttempts: options.maxReconnectAttempts,
        },
        this.env,
      );
      this.connections.set(channelPath, connection);
    }

    // Subscribe to the room on this connection
    const unsubscribe = connection.subscribe(roomId, handler, {
      onConnect: options.onConnect,
      onDisconnect: options.onDisconnect,
      onError: options.onError,
    });

    // Return unsubscribe function
    return () => {
      unsubscribe();

      // Clean up connection if no more rooms
      if (connection.getRooms().length === 0) {
        this.connections.delete(channelPath);
      }
    };
  }

  /**
   * Send message to a room on a channel
   */
  public async send<TClient extends TWSObject, TServer extends TWSObject>(
    roomId: string,
    channel: ChannelDescriptor<TClient, TServer>,
    message: Static<TServer>,
  ): Promise<void> {
    const channelPath = channel.options.path;
    const connection = this.connections.get(
      channelPath,
    ) as WebSocketChannelConnection<TClient, TServer>;

    if (!connection) {
      throw new Error(
        `Not subscribed to channel ${channelPath}. Subscribe first before sending messages.`,
      );
    }

    await connection.send(roomId, message);
  }

  /**
   * Get connection for a channel
   */
  public getConnection<TClient extends TWSObject, TServer extends TWSObject>(
    channel: ChannelDescriptor<TClient, TServer>,
  ): WebSocketChannelConnection<TClient, TServer> | undefined {
    const channelPath = channel.options.path;
    return this.connections.get(channelPath) as
      | WebSocketChannelConnection<TClient, TServer>
      | undefined;
  }

  /**
   * Disconnect all connections
   */
  public disconnectAll(): void {
    for (const connection of this.connections.values()) {
      connection.disconnect();
    }
    this.connections.clear();
  }
}
