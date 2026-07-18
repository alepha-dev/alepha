import type { Static } from "alepha";
import { useAlepha, useInject } from "alepha/react";
import type { ChannelPrimitive, TWSObject } from "alepha/websocket";
import { WebSocketClient } from "alepha/websocket";
import { useEffect, useRef, useState } from "react";

/**
 * UseRoom options
 */
export interface UseRoomOptions<
  TClient extends TWSObject,
  TServer extends TWSObject,
> {
  /**
   * Room ID to connect to
   */
  roomId: string;

  /**
   * Channel primitive defining the schemas
   */
  channel: ChannelPrimitive<TClient, TServer>;

  /**
   * Handler for incoming messages from the server
   */
  handler: (message: Static<TClient>) => void;

  /**
   * Optional WebSocket URL override
   * Defaults to auto-detected URL based on window.location
   */
  url?: string;

  /**
   * Enable automatic reconnection on disconnect
   * @default true
   */
  autoReconnect?: boolean;

  /**
   * Reconnection interval in milliseconds
   * @default 3000
   */
  reconnectInterval?: number;

  /**
   * Maximum reconnection attempts (-1 for infinite)
   * @default 10
   */
  maxReconnectAttempts?: number;

  /**
   * Called when connection is established
   */
  onConnect?: () => void;

  /**
   * Called when connection is closed
   */
  onDisconnect?: () => void;

  /**
   * Called on connection error
   */
  onError?: (error: Error) => void;
}

/**
 * UseRoom return value
 */
export interface UseRoomReturn<TServer extends TWSObject> {
  /**
   * Send a message to the server
   */
  send: (message: Static<TServer>) => Promise<void>;

  /**
   * Whether the connection is established
   */
  isConnected: boolean;

  /**
   * Whether the connection is in progress
   */
  isConnecting: boolean;

  /**
   * Whether there was an error
   */
  isError: boolean;

  /**
   * The error object if any
   */
  error?: Error;

  /**
   * Manually reconnect
   */
  reconnect: () => void;

  /**
   * Manually disconnect
   */
  disconnect: () => void;
}

/**
 * React hook for WebSocket room communication
 *
 * Provides automatic connection management, reconnection, and type-safe messaging
 * for WebSocket rooms using the injected WebSocketClient service.
 *
 * Multiple useRoom hooks on the same channel will share a single WebSocket connection.
 *
 * @example
 * ```tsx
 * const chat = useRoom({
 *   roomId: "room-123",
 *   channel: chatChannel,
 *   handler: (message) => {
 *     if (message.type === "append") {
 *       setMessages(prev => [...prev, message]);
 *     }
 *   }
 * }, [roomId]);
 *
 * const sendMessage = async () => {
 *   await chat.send({
 *     content: "Hello, world!"
 *   });
 * };
 * ```
 */
export const useRoom = <TClient extends TWSObject, TServer extends TWSObject>(
  options: UseRoomOptions<TClient, TServer>,
  deps: unknown[],
): UseRoomReturn<TServer> => {
  const webSocketClient = useInject(WebSocketClient);
  const unsubscribeRef = useRef<(() => void) | null>(null);

  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isError, setIsError] = useState(false);
  const [error, setError] = useState<Error | undefined>(undefined);

  const {
    roomId,
    channel,
    handler,
    url,
    autoReconnect,
    reconnectInterval,
    maxReconnectAttempts,
    onConnect,
    onDisconnect,
    onError,
  } = options;

  // Keep handler ref stable to avoid stale closures
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    // Subscribe to room — use ref so handler is always current
    const unsubscribe = webSocketClient.subscribe(
      roomId,
      channel,
      (msg) => handlerRef.current(msg),
      {
        url,
        autoReconnect,
        reconnectInterval,
        maxReconnectAttempts,
        onConnect: () => {
          setIsConnected(true);
          setIsConnecting(false);
          setIsError(false);
          setError(undefined);
          onConnect?.();
        },
        onDisconnect: () => {
          setIsConnected(false);
          setIsConnecting(false);
          onDisconnect?.();
        },
        onError: (err) => {
          setIsError(true);
          setError(err);
          setIsConnecting(false);
          onError?.(err);
        },
      },
    );

    unsubscribeRef.current = unsubscribe;

    // Get initial state from connection
    const connection = webSocketClient.getConnection(channel);
    if (connection) {
      setIsConnected(connection.isConnected);
      setIsConnecting(connection.isConnecting);
      setIsError(connection.isError);
      setError(connection.error);
    }

    // Cleanup on unmount or deps change
    return () => {
      unsubscribe();
      unsubscribeRef.current = null;
    };
  }, deps);

  const alepha = useAlepha();

  if (!alepha.isBrowser()) {
    return {
      send: async (_message: Static<TServer>) => {
        // No-op on server
      },
      isConnected: false,
      isConnecting: false,
      isError: false,
      error: undefined,
      reconnect: () => {
        // No-op on server
      },
      disconnect: () => {
        // No-op on server
      },
    };
  }

  return {
    send: async (message: Static<TServer>) => {
      await webSocketClient.send(roomId, channel, message);
    },
    isConnected,
    isConnecting,
    isError,
    error,
    reconnect: () => {
      const connection = webSocketClient.getConnection(channel);
      connection?.reconnect();
    },
    disconnect: () => {
      unsubscribeRef.current?.();
    },
  };
};
