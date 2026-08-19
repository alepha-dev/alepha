/**
 * React hooks for real-time WebSocket communication - `useRoom` connects a
 * component to a `$channel`, exposing typed `send` and the live message
 * stream, and no-ops during SSR.
 *
 * @module alepha.react.websocket
 */

export * from "./hooks/useRoom.tsx";
