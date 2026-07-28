import {
  $env,
  $inject,
  Alepha,
  AlephaError,
  SchemaValidator,
  type Static,
  z,
} from "alepha";
import { $logger } from "alepha/logger";
import type { ChannelPrimitive, TWSObject } from "../primitives/$channel.ts";

const envSchema = z.object({
  WEBSOCKET_URL: z.text({
    default: "",
    description:
      "WebSocket server URL (e.g., ws://localhost:3001). Leave empty to auto-detect.",
  }),
  WEBSOCKET_RECONNECT_INTERVAL: z
    .integer()
    .default(3000)
    .meta({ description: "Reconnection interval in milliseconds" }),
  WEBSOCKET_MAX_RECONNECT_ATTEMPTS: z.integer().default(10).meta({
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
  protected readonly alepha = $inject(Alepha);
  protected readonly schemaValidator = $inject(SchemaValidator);
  protected readonly log = $logger();
  protected ws?: WebSocket;
  protected reconnectAttempts = 0;
  protected reconnectTimer?: ReturnType<typeof setTimeout>;
  protected manuallyClosed = false;
  protected static readonly MAX_QUEUE_SIZE = 1000;

  /**
   * Key the server stamps on an outbound frame to say which room it belongs
   * to. One socket serves every room this client subscribed to, so without it
   * the client cannot tell whose message it just received.
   *
   * Stripped before validation and before the handler sees the payload — it is
   * transport metadata, not part of the channel's `in` schema.
   */
  public static readonly ROOM_MARKER = "__alephaRoom";
  protected messageQueue: Array<{ roomId: string; message: Static<TServer> }> =
    [];

  /**
   * Room subscriptions, `roomId -> set of handlers`.
   *
   * A Set, not a single handler: two components subscribing to the same room
   * is the ordinary UI case, and with one slot the second overwrote the first
   * — then either component's unsubscribe deleted the survivor.
   */
  protected subscriptions = new Map<
    string,
    Set<(message: Static<TClient>) => void>
  >();

  // Connection state
  public isConnected = false;
  public isConnecting = false;
  public isError = false;
  public error?: Error;
  protected connectPromise?: Promise<void>;

  // Connection callbacks
  protected onConnectCallbacks = new Set<() => void>();
  protected onDisconnectCallbacks = new Set<() => void>();
  protected onErrorCallbacks = new Set<(error: Error) => void>();

  constructor(
    protected readonly channel: ChannelPrimitive<TClient, TServer>,
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
    this.log.trace("Building WebSocket URL", {
      hasCustomUrl: !!this.options.url,
      channelPath: this.channel.options.path,
    });

    if (this.options.url) {
      this.log.debug("Using custom WebSocket URL", { url: this.options.url });
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
      const url = `${protocol}//${host}${path}${roomParam}`;
      this.log.debug("Auto-detected WebSocket URL", { url, roomIds });
      return url;
    }

    // Fallback to env URL
    const url = `${this.env.WEBSOCKET_URL}${this.channel.options.path}`;
    this.log.debug("Using env WebSocket URL", { url });
    return url;
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
    this.log.debug("Subscribing to room", {
      roomId,
      channelPath: this.channel.options.path,
      existingSubscriptions: this.subscriptions.size,
    });

    // Add subscription
    const existing = this.subscriptions.get(roomId);
    const alreadyJoined = existing !== undefined;
    if (existing) {
      existing.add(handler);
    } else {
      this.subscriptions.set(roomId, new Set([handler]));
    }

    // Add callbacks
    if (callbacks?.onConnect) this.onConnectCallbacks.add(callbacks.onConnect);
    if (callbacks?.onDisconnect)
      this.onDisconnectCallbacks.add(callbacks.onDisconnect);
    if (callbacks?.onError) this.onErrorCallbacks.add(callbacks.onError);

    // Connect or reconnect to include the new room in the URL.
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.log.trace("No active connection, initiating connect");
      this.connect().catch((error) => {
        this.log.error("Failed to connect:", error);
      });
    } else if (!alreadyJoined) {
      // Only when the room is NEW to this connection. A second subscriber to
      // a room we already joined used to tear down the live socket — every
      // other component on it saw a disconnect for nothing.
      this.log.trace("Reconnecting to include new room subscription", {
        roomId,
      });
      this.reconnect();
    }

    // Return unsubscribe function
    return () => {
      this.log.debug("Unsubscribing from room", { roomId });
      const handlers = this.subscriptions.get(roomId);
      handlers?.delete(handler);
      // Only drop the room once its LAST subscriber leaves.
      if (handlers && handlers.size === 0) {
        this.subscriptions.delete(roomId);
      }
      if (callbacks?.onConnect)
        this.onConnectCallbacks.delete(callbacks.onConnect);
      if (callbacks?.onDisconnect)
        this.onDisconnectCallbacks.delete(callbacks.onDisconnect);
      if (callbacks?.onError) this.onErrorCallbacks.delete(callbacks.onError);

      // Disconnect if no more subscriptions
      if (this.subscriptions.size === 0) {
        this.log.debug("No more subscriptions, disconnecting");
        this.disconnect();
      }
    };
  }

  /**
   * Connect to WebSocket server
   */
  protected async connect(): Promise<void> {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.log.trace("Already connected, skipping connect");
      return;
    }

    if (this.connectPromise) {
      this.log.trace("Connection already in progress, reusing promise");
      return this.connectPromise;
    }

    this.isConnecting = true;
    this.isError = false;
    this.error = undefined;
    // An explicit connect() supersedes any prior intentional disconnect.
    this.manuallyClosed = false;

    const url = this.buildUrl();
    this.log.info("Connecting to WebSocket server", { url });

    this.connectPromise = new Promise<void>((resolve, reject) => {
      try {
        const ws = new WebSocket(url);
        this.ws = ws;

        ws.onopen = () => {
          this.isConnected = true;
          this.isConnecting = false;
          this.isError = false;
          this.error = undefined;
          this.reconnectAttempts = 0;

          this.log.info("WebSocket connected", {
            channelPath: this.channel.options.path,
            rooms: Array.from(this.subscriptions.keys()),
          });

          // Flush queued messages
          if (this.messageQueue.length > 0) {
            this.log.debug("Flushing queued messages", {
              count: this.messageQueue.length,
            });
          }
          while (this.messageQueue.length > 0) {
            const msg = this.messageQueue.shift();
            if (msg) {
              this.log.trace("Sending queued message", { roomId: msg.roomId });
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
          this.log.trace("Message received", {
            dataLength: event.data?.length,
          });
          this.handleMessage(event.data);
        };

        ws.onclose = (event) => {
          this.isConnected = false;
          this.isConnecting = false;
          this.ws = undefined;

          this.log.info("WebSocket disconnected", {
            code: event.code,
            reason: event.reason,
            wasClean: event.wasClean,
          });

          // Call all disconnect callbacks
          for (const callback of this.onDisconnectCallbacks) {
            callback();
          }

          // Attempt reconnection — but never after an intentional disconnect(),
          // which would leak an ownerless zombie connection.
          if (!this.manuallyClosed && this.options.autoReconnect !== false) {
            this.scheduleReconnect();
          }
        };

        ws.onerror = () => {
          const err = new Error("WebSocket connection error");
          this.isError = true;
          this.error = err;
          this.isConnecting = false;

          this.log.error("WebSocket error", { url });

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

        this.log.error("Failed to create WebSocket", { error: error.message });

        // Call all error callbacks
        for (const callback of this.onErrorCallbacks) {
          callback(error);
        }

        reject(error);
      }
    }).finally(() => {
      this.connectPromise = undefined;
    });

    return this.connectPromise;
  }

  /**
   * Handle incoming message
   */
  protected handleMessage(data: string): void {
    try {
      const parsed = JSON.parse(data);
      this.log.trace("Parsed incoming message", { parsed });

      const marker = WebSocketChannelConnection.ROOM_MARKER;
      const roomId =
        parsed &&
        typeof parsed === "object" &&
        typeof parsed[marker] === "string"
          ? (parsed[marker] as string)
          : undefined;

      // Transport metadata — must not reach the schema or the handler.
      if (roomId !== undefined) {
        delete parsed[marker];
      }

      // Validate incoming message against schema
      const inSchema = this.channel.options.schema.in;
      this.alepha.codec.validate(inSchema, parsed);

      this.log.debug("Dispatching message to handlers", {
        handlerCount: this.subscriptions.size,
        roomId,
      });

      if (roomId !== undefined) {
        // Addressed frame: only the room it was sent to. Fanning it to every
        // handler delivered room A's messages to room B.
        const handlers = this.subscriptions.get(roomId);
        if (handlers?.size) {
          for (const handler of handlers) {
            handler(parsed as Static<TClient>);
          }
        } else {
          this.log.trace("No handler for room", { roomId });
        }
        return;
      }

      // Unaddressed frame (channel-wide emit, or a server that predates the
      // marker) — every subscriber is a legitimate recipient.
      for (const handlers of this.subscriptions.values()) {
        for (const handler of handlers) {
          handler(parsed as Static<TClient>);
        }
      }
    } catch (err) {
      this.log.error("Error handling message:", err);
    }
  }

  /**
   * Send message to a specific room
   */
  public async send(roomId: string, message: Static<TServer>): Promise<void> {
    this.log.trace("Sending message", { roomId, message });

    // Validate outgoing message against schema
    const outSchema = this.channel.options.schema.out;
    try {
      this.schemaValidator.validate(outSchema, message);
    } catch (err) {
      this.log.warn("Message validation failed", { error: err });
      throw new AlephaError(
        `Message validation failed: ${(err as Error).message}`,
      );
    }

    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      if (
        this.messageQueue.length >= WebSocketChannelConnection.MAX_QUEUE_SIZE
      ) {
        this.log.warn("Message queue full, dropping oldest message", {
          roomId,
          queueSize: this.messageQueue.length,
        });
        this.messageQueue.shift();
      }
      this.log.debug("Connection not ready, queuing message", {
        roomId,
        queueSize: this.messageQueue.length + 1,
      });
      this.messageQueue.push({ roomId, message });
      return;
    }

    this.log.debug("Sending message to server", { roomId });
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
    // Clear any pending reconnect timer
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }

    const maxAttempts =
      this.options.maxReconnectAttempts ??
      this.env.WEBSOCKET_MAX_RECONNECT_ATTEMPTS ??
      10;
    const reconnectInterval =
      this.options.reconnectInterval ??
      this.env.WEBSOCKET_RECONNECT_INTERVAL ??
      3000;

    if (maxAttempts !== -1 && this.reconnectAttempts >= maxAttempts) {
      this.log.warn("Max reconnection attempts reached", {
        attempts: this.reconnectAttempts,
        maxAttempts,
      });
      return;
    }

    this.reconnectAttempts++;

    this.log.debug("Scheduling reconnection", {
      attempt: this.reconnectAttempts,
      maxAttempts,
      intervalMs: reconnectInterval,
    });

    this.reconnectTimer = setTimeout(() => {
      this.log.info("Reconnecting...", {
        attempt: this.reconnectAttempts,
        maxAttempts,
      });
      this.connect().catch((error) => {
        this.log.error("Reconnection failed:", error);
      });
    }, reconnectInterval);
  }

  /**
   * Disconnect from server
   */
  public disconnect(): void {
    this.log.debug("Disconnecting", {
      hasTimer: !!this.reconnectTimer,
      hasConnection: !!this.ws,
    });

    this.manuallyClosed = true;

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
    this.connectPromise = undefined;

    this.log.info("Disconnected");
  }

  /**
   * Reconnect manually
   */
  public reconnect(): void {
    this.log.info("Manual reconnect requested");
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
    channel: ChannelPrimitive<TClient, TServer>,
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

    this.log.debug("WebSocketClient.subscribe", {
      roomId,
      channelPath,
      existingConnections: this.connections.size,
    });

    // Get or create connection for this channel
    let connection = this.connections.get(
      channelPath,
    ) as WebSocketChannelConnection<TClient, TServer>;

    if (!connection) {
      this.log.debug("Creating new connection for channel", { channelPath });
      connection = this.alepha.inject(WebSocketChannelConnection, {
        lifetime: "transient",
        args: [
          channel,
          {
            url: options.url,
            autoReconnect: options.autoReconnect,
            reconnectInterval: options.reconnectInterval,
            maxReconnectAttempts: options.maxReconnectAttempts,
          },
          this.env,
        ],
      }) as WebSocketChannelConnection<any, any>;

      this.connections.set(channelPath, connection);
    } else {
      this.log.trace("Reusing existing connection for channel", {
        channelPath,
      });
    }

    // Subscribe to the room on this connection
    const unsubscribe = connection.subscribe(roomId, handler, {
      onConnect: options.onConnect,
      onDisconnect: options.onDisconnect,
      onError: options.onError,
    });

    // Return unsubscribe function
    return () => {
      this.log.debug("WebSocketClient.unsubscribe", { roomId, channelPath });
      unsubscribe();

      // Clean up connection if no more rooms
      if (connection.getRooms().length === 0) {
        this.log.debug("Removing connection for channel (no more rooms)", {
          channelPath,
        });
        this.connections.delete(channelPath);
      }
    };
  }

  /**
   * Send message to a room on a channel
   */
  public async send<TClient extends TWSObject, TServer extends TWSObject>(
    roomId: string,
    channel: ChannelPrimitive<TClient, TServer>,
    message: Static<TServer>,
  ): Promise<void> {
    const channelPath = channel.options.path;

    this.log.trace("WebSocketClient.send", { roomId, channelPath });

    const connection = this.connections.get(
      channelPath,
    ) as WebSocketChannelConnection<TClient, TServer>;

    if (!connection) {
      this.log.warn("Attempted to send on unsubscribed channel", {
        channelPath,
      });
      throw new AlephaError(
        `Not subscribed to channel ${channelPath}. Subscribe first before sending messages.`,
      );
    }

    await connection.send(roomId, message);
  }

  /**
   * Get connection for a channel
   */
  public getConnection<TClient extends TWSObject, TServer extends TWSObject>(
    channel: ChannelPrimitive<TClient, TServer>,
  ): WebSocketChannelConnection<TClient, TServer> | undefined {
    const channelPath = channel.options.path;
    const connection = this.connections.get(channelPath) as
      | WebSocketChannelConnection<TClient, TServer>
      | undefined;

    this.log.trace("WebSocketClient.getConnection", {
      channelPath,
      found: !!connection,
    });

    return connection;
  }

  /**
   * Disconnect all connections
   */
  public disconnectAll(): void {
    this.log.info("Disconnecting all connections", {
      count: this.connections.size,
    });

    for (const connection of this.connections.values()) {
      connection.disconnect();
    }
    this.connections.clear();

    this.log.debug("All connections disconnected");
  }
}
