import type { Static } from "alepha";
import type { ChannelPrimitive, TWSObject } from "../primitives/$channel.ts";

/**
 * A pluggable timer, so the {@link RoomEngine} tick loop is driven the same way
 * on every runtime and can be fully unit-tested with a fake clock.
 *
 * - Node binds this to `globalThis.setInterval` / `clearInterval` / `Date.now`.
 * - Cloudflare binds it to the Durable Object isolate's own `setInterval`
 *   (which stays alive while the room holds an accepted WebSocket).
 * - Tests bind a deterministic fake that advances virtual time by hand.
 */
export interface RoomClock {
  setInterval(fn: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
  /** Monotonic-ish milliseconds; only differences are used (for `dt`). */
  now(): number;
}

/**
 * The transport-level view of one connected socket the {@link RoomEngine}
 * needs. Each provider adapts its native socket (Node `ws`, or a Cloudflare
 * hibernation socket) to this shape.
 */
export interface RoomSocket {
  /** Stable per-connection id (survives hibernation on Cloudflare). */
  readonly id: string;
  /** Authenticated user id, when the channel is `secure`. */
  readonly userId?: string;
  /**
   * The upgrade URL's query parameters, verbatim (first value per key). The
   * roomId is already extracted from these, but an application may carry extra
   * identity hints here (e.g. lindocara's `?hero=` beside `?roomId=`) that its
   * `onJoin` re-validates server-side. Untrusted client input by definition —
   * never authorize from it without re-derivation.
   */
  readonly query?: Readonly<Record<string, string>>;
  /**
   * Per-connection mutable bag the application owns (e.g. lindocara stores the
   * hero id, last acked input seq, AOI cursor here). Never serialized by the
   * engine.
   */
  data: Record<string, unknown>;
  /** Send an already-serialized frame to this one socket. */
  sendRaw(data: string): void;
  /** Close this one socket. */
  close(code?: number, reason?: string): void;
}

/**
 * The per-connection slice exposed to application callbacks — the socket
 * without its raw transport methods.
 */
export interface RoomConnection {
  readonly id: string;
  readonly userId?: string;
  /** See {@link RoomSocket.query} — untrusted upgrade-URL query parameters. */
  readonly query?: Readonly<Record<string, string>>;
  data: Record<string, unknown>;
}

/**
 * The room handle passed to every application callback (`onJoin`, `onTick`,
 * `onMessage`, `onLeave`, `onEmpty`, and each `methods` entry). It is the only
 * surface the application touches: it never sees a raw socket or a Durable
 * Object.
 */
export interface RoomContext<TClient extends TWSObject, TState> {
  /** This room's id (e.g. lindocara's `partyId:mapId`). */
  readonly roomId: string;
  /**
   * The room's in-memory state, created once by the `state` factory on first
   * join and discarded when the room empties. This is where the authoritative
   * world lives (players, monsters, loot…).
   */
  readonly state: TState;
  /** Live view of the connected sockets, for iteration during a tick. */
  readonly connections: readonly RoomConnection[];
  /** Number of connected sockets. */
  readonly size: number;
  /** Send one message to one connection. Validated? No — trusted server frame. */
  send(connectionId: string, message: Static<TClient>): void;
  /** Fan out one message to every connection, minus any excepted ids. */
  broadcast(
    message: Static<TClient>,
    options?: { exceptConnectionIds?: string[] },
  ): void;
  /** Close one connection. */
  close(connectionId: string, code?: number, reason?: string): void;
}

/**
 * A server-side method callable on a room from outside it (another room, the
 * main isolate, an HTTP action). This is the seam that lets a headless
 * coordinator room (lindocara's `GameSession`) receive state mutations pushed
 * up from a world room, and lets a presence room (`HeroPresence`) expose
 * acquire/renew/release. On Cloudflare each call is a Durable Object RPC; on
 * Node it is a direct in-process method call.
 */
export type RoomMethod<
  TClient extends TWSObject,
  TServer extends TWSObject,
  TState,
> = (room: RoomContext<TClient, TState>, ...args: any[]) => any | Promise<any>;

/**
 * Options for the {@link $room} primitive — a stateful, optionally
 * tick-driven room.
 *
 * With `tickHz > 0` it is an authoritative simulation room (lindocara's
 * `World`). With `tickHz` omitted/0 it is a headless coordinator addressed by
 * id and reached through `methods` (lindocara's `GameSession` / `HeroPresence`).
 */
export interface RoomPrimitiveOptions<
  TClient extends TWSObject,
  TServer extends TWSObject,
  TState = undefined,
> {
  /** The channel (message schemas + path) this room speaks. */
  channel: ChannelPrimitive<TClient, TServer>;

  /**
   * Server tick frequency in Hz. Omit or `0` for a headless room (no loop).
   * The loop only runs while at least one socket is connected, so an empty
   * room costs nothing.
   */
  tickHz?: number;

  /**
   * Factory for the room's in-memory state, invoked once when the room comes
   * to life (first join, or first method call on a headless room) and
   * discarded when it empties.
   */
  state?: (ctx: { roomId: string }) => TState | Promise<TState>;

  /** A socket joined this room. */
  onJoin?: (
    room: RoomContext<TClient, TState>,
    connection: RoomConnection,
  ) => void | Promise<void>;

  /** A validated client message arrived. */
  onMessage?: (
    room: RoomContext<TClient, TState>,
    connection: RoomConnection,
    message: Static<TServer>,
  ) => void | Promise<void>;

  /**
   * One authoritative tick. `dt` is elapsed milliseconds since the previous
   * tick. Never throws out of the loop — errors are logged and swallowed so a
   * bad tick cannot kill the room.
   */
  onTick?: (
    room: RoomContext<TClient, TState>,
    dt: number,
  ) => void | Promise<void>;

  /** A socket left this room. */
  onLeave?: (
    room: RoomContext<TClient, TState>,
    connection: RoomConnection,
  ) => void | Promise<void>;

  /**
   * The last socket left: persist and tear down. After this returns the tick
   * loop is stopped and the state is discarded.
   */
  onEmpty?: (room: RoomContext<TClient, TState>) => void | Promise<void>;

  /**
   * Server-side methods callable on this room by id from outside it. The seam
   * for coordinator/presence rooms.
   */
  methods?: Record<string, RoomMethod<TClient, TServer, TState>>;

  /** Enforce authentication on the handshake (via alepha/security). */
  secure?: boolean;

  /** Cap simultaneous connections per authenticated user. */
  maxConnectionsPerUser?: number;
}
