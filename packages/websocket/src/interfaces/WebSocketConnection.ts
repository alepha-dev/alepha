import type { TSchema } from "@alepha/core";

/**
 * WebSocket connection interface
 */
export interface WebSocketConnection {
  /**
   * Unique connection ID
   */
  id: string;

  /**
   * Send a message to this connection
   */
  send(message: any): Promise<void>;

  /**
   * Close this connection
   */
  close(code?: number, reason?: string): Promise<void>;

  /**
   * Connection metadata (user info, session, etc.)
   */
  metadata?: Record<string, any>;

  /**
   * Connection state
   */
  readyState: WebSocketState;
}

/**
 * WebSocket state enum
 */
export enum WebSocketState {
  CONNECTING = 0,
  OPEN = 1,
  CLOSING = 2,
  CLOSED = 3,
}

/**
 * WebSocket endpoint configuration
 */
export interface WebSocketConfig<TMessageSchema extends TSchema = TSchema> {
  /**
   * WebSocket endpoint path (e.g., "/ws/chat")
   */
  path: string;

  /**
   * Optional description for documentation
   */
  description?: string;

  /**
   * Message schema for validation
   */
  schema?: {
    message?: TMessageSchema;
  };

  /**
   * Handler for incoming messages
   */
  handler: WebSocketHandler<TMessageSchema>;

  /**
   * Optional connection handler (called when a client connects)
   */
  onConnect?: (connection: WebSocketConnection) => Promise<void> | void;

  /**
   * Optional disconnection handler (called when a client disconnects)
   */
  onDisconnect?: (connection: WebSocketConnection) => Promise<void> | void;
}

/**
 * WebSocket message handler
 */
export type WebSocketHandler<TMessageSchema extends TSchema = TSchema> = (
  context: WebSocketHandlerContext<TMessageSchema>,
) => Promise<void> | void;

/**
 * WebSocket handler context
 */
export interface WebSocketHandlerContext<
  TMessageSchema extends TSchema = TSchema,
> {
  /**
   * The parsed and validated message
   */
  message: TMessageSchema extends TSchema ? any : any;

  /**
   * The connection that sent the message
   */
  connection: WebSocketConnection;

  /**
   * Broadcast a message to all connected clients
   */
  broadcast: (message: any) => Promise<void>;

  /**
   * Send a message to a specific connection
   */
  sendTo: (connectionId: string, message: any) => Promise<void>;

  /**
   * Get all active connections
   */
  getConnections: () => WebSocketConnection[];
}
