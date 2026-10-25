import type { ActorHostDeclaration } from "alepha/actor";
/**
 * Stable specialized WebSocket native host identity for generic build wiring.
 */
export class WebSocketHost {
  public static readonly declaration: ActorHostDeclaration = Object.freeze({
    exportName: "AlephaWebSocketDurableObject",
    module: "alepha/websocket",
    moduleExport: "AlephaWebSocketDurableObject",
    binding: "ALEPHA_WEBSOCKET",
    backend: "sqlite",
  });
}
