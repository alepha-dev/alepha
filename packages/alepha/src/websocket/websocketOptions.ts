import { $atom, type Infer, z } from "alepha";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * WebSocket configuration atom.
 *
 * Lives in its own module (not beside `NodeWebSocketServerProvider`) because
 * it is runtime-agnostic app configuration: applications seed it from their
 * own env plumbing and every entry — node, workerd, browser — must be able to
 * export it without dragging in the Node provider's `ws` dependency, which
 * must never reach a workerd bundle (see `__tests__/workerd-entry-graph.spec.ts`).
 */
export const websocketOptions = $atom({
  name: "alepha.websocket.options",
  schema: z.object({
    path: z.text({
      default: "/ws",
      description: "Base path for WebSocket endpoints.",
    }),
    maxPayload: z
      .integer()
      .meta({ min: 1 })
      .describe(
        "Maximum WebSocket frame size in bytes, passed straight to the underlying `ws` " +
          "server (`new WebSocketServer({ maxPayload })`). This is a PRE-PARSE transport " +
          "backstop: `ws` enforces it against the raw frame before it ever reaches " +
          "`onMessage`/`JSON.parse`, so a hostile client cannot make the server spend CPU " +
          "parsing an arbitrarily large payload just because an application's own, later " +
          "app-level cap would eventually reject it. A frame over this limit closes the " +
          "connection with code 1009 automatically (`ws`'s own behaviour). An application with " +
          "a narrower per-message cap should still enforce it itself for the correct close " +
          "semantics; this atom only bounds the outer ceiling. Override via app state " +
          "(`Alepha.create({ [websocketOptions.key]: { path, maxPayload } })`) — e.g. from an " +
          "app-level `WEBSOCKET_MAX_PAYLOAD` environment variable — to raise or lower it.",
      )
      .default(1_048_576),
  }),
  default: {
    path: "/ws",
    maxPayload: 1_048_576,
  },
  serverOnly: true,
});

export type WebSocketOptions = Infer<typeof websocketOptions.schema>;

declare module "alepha" {
  interface State {
    [websocketOptions.key]: WebSocketOptions;
  }
}
