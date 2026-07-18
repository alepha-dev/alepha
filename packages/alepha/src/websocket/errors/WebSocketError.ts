import { AlephaError } from "alepha";

/**
 * Base WebSocket error class
 */
export class WebSocketError extends AlephaError {
  constructor(
    message: string,
    public readonly code?: number,
  ) {
    super(message);
    this.name = "WebSocketError";
  }
}

/**
 * Error thrown when WebSocket connection fails
 */
export class WebSocketConnectionError extends WebSocketError {
  constructor(message: string, code?: number) {
    super(message, code);
    this.name = "WebSocketConnectionError";
  }
}

/**
 * Error thrown when WebSocket message validation fails
 */
export class WebSocketValidationError extends WebSocketError {
  constructor(message: string) {
    super(message);
    this.name = "WebSocketValidationError";
  }
}
