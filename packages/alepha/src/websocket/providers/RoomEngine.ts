import { AlephaError } from "alepha";
import type {
  RoomClock,
  RoomConnection,
  RoomContext,
  RoomPrimitiveOptions,
  RoomSocket,
} from "../interfaces/RoomInterfaces.ts";
import type { TWSObject } from "../primitives/$channel.ts";

/** Dependencies a {@link RoomEngine} needs from whatever runtime hosts it. */
export interface RoomEngineDeps<
  TClient extends TWSObject,
  TServer extends TWSObject,
  TState,
> {
  roomId: string;
  options: RoomPrimitiveOptions<TClient, TServer, TState>;
  clock: RoomClock;
  /** Validate a client message against the channel `out` schema. Throws on invalid. */
  validate?: (message: unknown) => void;
  /** Best-effort structured logging; never throws. */
  log?: (level: "warn" | "error", message: string, data?: unknown) => void;
}

/**
 * Runtime-neutral heart of a stateful room: it owns the in-memory state, the
 * connected sockets, the authoritative tick loop, per-recipient send and the
 * room lifecycle — with zero dependency on Node's `ws` or on
 * `cloudflare:workers`. Both providers construct one of these and feed it their
 * native sockets through the {@link RoomSocket} adapter.
 *
 * Lifecycle: the room comes to life lazily (first `join`, or first `call` on a
 * headless room), running the `state` factory once. While at least one socket
 * is connected and `tickHz > 0`, a loop calls `onTick` every `1000/tickHz` ms.
 * When the last socket leaves, `onEmpty` runs, the loop stops and the state is
 * discarded — so an empty room costs nothing.
 */
export class RoomEngine<
  TClient extends TWSObject,
  TServer extends TWSObject,
  TState,
> {
  protected readonly sockets = new Map<string, RoomSocket>();
  protected state?: TState;
  protected alive = false;
  protected starting?: Promise<void>;
  protected tickHandle?: unknown;
  protected lastTickAt = 0;
  /**
   * True while an async `onTick` is still in flight, so the loop can skip a
   * beat rather than run two overlapping simulation steps.
   */
  protected ticking = false;

  constructor(
    protected readonly deps: RoomEngineDeps<TClient, TServer, TState>,
  ) {}

  get size(): number {
    return this.sockets.size;
  }

  protected get options(): RoomPrimitiveOptions<TClient, TServer, TState> {
    return this.deps.options;
  }

  /**
   * Admit a socket. Brings the room to life on the first join and starts the
   * tick loop if this room ticks.
   */
  async join(socket: RoomSocket): Promise<void> {
    await this.ensureAlive();
    this.sockets.set(socket.id, socket);
    await this.options.onJoin?.(this.context(), socket);
    this.ensureLoop();
  }

  /**
   * Dispatch a validated client message to `onMessage`. Malformed messages and
   * handler errors are logged and reported back to the offending socket on a
   * best-effort basis — never rethrown, so one bad frame cannot kill the room.
   */
  async message(socketId: string, message: unknown): Promise<void> {
    const socket = this.sockets.get(socketId);
    if (!socket) return;
    try {
      this.deps.validate?.(message);
    } catch (error) {
      this.deps.log?.(
        "error",
        `Invalid WebSocket message on ${socketId}`,
        error,
      );
      this.sendError(socket, error);
      return;
    }
    try {
      await this.options.onMessage?.(this.context(), socket, message as never);
    } catch (error) {
      this.deps.log?.(
        "error",
        `Error handling WebSocket message on ${socketId}`,
        error,
      );
      this.sendError(socket, error);
    }
  }

  /**
   * Remove a socket. When the last one leaves, `onEmpty` runs and the room is
   * torn down.
   */
  async leave(socketId: string): Promise<void> {
    const socket = this.sockets.get(socketId);
    if (!socket) return;
    this.sockets.delete(socketId);
    // A throwing onLeave must never abort teardown (same contract as
    // onEmpty): the tick loop would keep firing on an empty room — an
    // indefinite billable spin on Cloudflare — and onEmpty, the persistence
    // hook, would never run.
    try {
      await this.options.onLeave?.(this.context(), socket);
    } catch (error) {
      this.deps.log?.(
        "error",
        `Error in onLeave for room ${this.deps.roomId}`,
        error,
      );
    }
    if (this.sockets.size === 0) await this.teardown();
  }

  /**
   * Invoke a server-side room method by name (the coordinator/presence seam).
   * Brings a headless room to life on its first call.
   */
  async call(method: string, args: unknown[] = []): Promise<unknown> {
    await this.ensureAlive();
    const fn = this.options.methods?.[method];
    if (!fn) {
      throw new AlephaError(
        `Room method '${method}' is not defined on this room.`,
      );
    }
    return fn(this.context(), ...args);
  }

  /**
   * Server-initiated fan-out to every connected socket. The seam a coordinator
   * uses to push a fresh state snapshot down into a room from outside any
   * callback.
   */
  broadcast(
    message: unknown,
    options?: { exceptConnectionIds?: string[] },
  ): void {
    this.context().broadcast(message as never, options);
  }

  /** Server-initiated send to one connection. */
  send(connectionId: string, message: unknown): void {
    this.context().send(connectionId, message as never);
  }

  /**
   * Stop the tick loop without running `onEmpty`. For host shutdown, where the
   * whole process is going away and per-room persistence is the application's
   * concern via its own stop hook.
   */
  dispose(): void {
    this.stopLoop();
  }

  // -------------------------------------------------------------------------

  protected async ensureAlive(): Promise<void> {
    if (this.alive) return;
    if (!this.starting) {
      this.starting = (async () => {
        this.state = await this.options.state?.({ roomId: this.deps.roomId });
        this.alive = true;
      })().catch((error) => {
        // Drop the cached rejection so the next join/call retries the
        // factory. Keeping it would latch the room broken forever — a
        // headless coordinator reached via `call()` never reaches teardown
        // (no socket ever joined), so it would need a process restart.
        this.starting = undefined;
        throw error;
      });
    }
    await this.starting;
  }

  protected async teardown(): Promise<void> {
    this.stopLoop();
    try {
      await this.options.onEmpty?.(this.context());
    } catch (error) {
      this.deps.log?.(
        "error",
        `Error in onEmpty for room ${this.deps.roomId}`,
        error,
      );
    }
    this.alive = false;
    this.starting = undefined;
    this.state = undefined;
  }

  protected ensureLoop(): void {
    const hz = this.options.tickHz ?? 0;
    if (this.tickHandle != null || hz <= 0 || this.sockets.size === 0) return;
    this.lastTickAt = this.deps.clock.now();
    this.tickHandle = this.deps.clock.setInterval(() => this.tick(), 1000 / hz);
  }

  protected stopLoop(): void {
    if (this.tickHandle == null) return;
    this.deps.clock.clearInterval(this.tickHandle);
    this.tickHandle = undefined;
  }

  protected tick(): void {
    // An async `onTick` slower than 1000/tickHz would otherwise overlap its
    // own next invocation, and for an authoritative simulation two concurrent
    // `state.step(dt)` calls corrupt the world. Skip the beat instead, and say
    // so — a room that cannot keep up is a capacity problem worth surfacing.
    // Mirrors CronProvider's `executing` guard.
    if (this.ticking) {
      this.deps.log?.(
        "warn",
        `Skipping tick for room ${this.deps.roomId}: the previous onTick is still running`,
      );
      return;
    }

    const now = this.deps.clock.now();
    const dt = now - this.lastTickAt;
    this.lastTickAt = now;

    const onError = (error: unknown) =>
      this.deps.log?.(
        "error",
        `Error in onTick for room ${this.deps.roomId}`,
        error,
      );

    try {
      const result = this.options.onTick?.(this.context(), dt);
      if (result instanceof Promise) {
        this.ticking = true;
        result.catch(onError).finally(() => {
          this.ticking = false;
        });
      }
    } catch (error) {
      onError(error);
    }
  }

  protected context(): RoomContext<TClient, TState> {
    const sockets = this.sockets;
    const serialize = (message: unknown) =>
      typeof message === "string" ? message : JSON.stringify(message);
    const sendTo = (socket: RoomSocket, data: string) => {
      try {
        socket.sendRaw(data);
      } catch (error) {
        this.deps.log?.("warn", `Failed to send to ${socket.id}`, error);
      }
    };
    return {
      roomId: this.deps.roomId,
      state: this.state as TState,
      get connections(): readonly RoomConnection[] {
        return [...sockets.values()];
      },
      get size(): number {
        return sockets.size;
      },
      send: (connectionId, message) => {
        const socket = sockets.get(connectionId);
        if (socket) sendTo(socket, serialize(message));
      },
      broadcast: (message, options) => {
        const except = new Set(options?.exceptConnectionIds ?? []);
        const data = serialize(message);
        for (const socket of sockets.values()) {
          if (!except.has(socket.id)) sendTo(socket, data);
        }
      },
      close: (connectionId, code, reason) => {
        sockets.get(connectionId)?.close(code, reason);
      },
    };
  }

  protected sendError(socket: RoomSocket, error: unknown): void {
    try {
      socket.sendRaw(
        JSON.stringify({
          error: error instanceof Error ? error.message : "Unknown error",
        }),
      );
    } catch {
      // socket may already be closing/closed — nothing more we can do
    }
  }
}
