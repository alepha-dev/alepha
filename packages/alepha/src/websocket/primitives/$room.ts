import { $inject, createPrimitive, KIND, Primitive } from "alepha";
import type { RoomPrimitiveOptions } from "../interfaces/RoomInterfaces.ts";
import { WebSocketServerProvider } from "../providers/WebSocketServerProvider.ts";
import type { TWSObject } from "./$channel.ts";

/**
 * Defines a **stateful** WebSocket room — the home for an authoritative,
 * optionally tick-driven simulation.
 *
 * Where {@link $websocket} is a stateless, per-message pub/sub handler, `$room`
 * holds in-memory state across messages and drives a server-side tick loop. It
 * is the primitive a real-time game server is built on:
 *
 * - `tickHz > 0` → an authoritative simulation room. The loop runs only while a
 *   socket is connected (an empty room costs nothing), calling `onTick(room, dt)`
 *   every `1000/tickHz` ms. Inside a tick you read `room.state`, iterate
 *   `room.connections`, and push per-recipient frames with `room.send(id, msg)`
 *   or `room.broadcast(msg)`.
 * - `tickHz` omitted → a **headless coordinator** addressed by id and reached
 *   through server-side `methods`. This is how you model cross-room party state
 *   or a single-owner presence lease.
 *
 * Same code runs on Node (one process, real timers) and on Cloudflare (one
 * Durable Object per `channelPath:roomId`, the loop alive while the socket is).
 *
 * @example An authoritative 20Hz world
 * ```typescript
 * class GameServer {
 *   world = $channel({ path: "/ws/world", schema: { in: serverMsg, out: clientIntent } });
 *
 *   room = $room({
 *     channel: this.world,
 *     tickHz: 20,
 *     state: () => new World(),
 *     onJoin:    (room, conn) => room.state.addPlayer(conn.id),
 *     onMessage: (room, conn, intent) => room.state.enqueue(conn.id, intent),
 *     onTick:    (room, dt) => {
 *       room.state.step(dt);
 *       for (const conn of room.connections) room.send(conn.id, room.state.viewFor(conn.id));
 *     },
 *     onLeave:   (room, conn) => room.state.removePlayer(conn.id),
 *     onEmpty:   (room) => room.state.persist(),
 *   });
 * }
 * ```
 *
 * @example A headless coordinator (party-wide state)
 * ```typescript
 * class Coordinator {
 *   party = $channel({ path: "/ws/party", schema: { in: any, out: any } });
 *
 *   session = $room({
 *     channel: this.party,
 *     state: () => ({ switches: {} as Record<string, boolean> }),
 *     methods: {
 *       setSwitch: (room, id: string, value: boolean) => { room.state.switches[id] = value; },
 *       snapshot:  (room) => room.state.switches,
 *     },
 *   });
 *
 *   async flip(partyId: string, id: string) {
 *     await this.session.call(partyId, "setSwitch", id, true);
 *   }
 * }
 * ```
 */
export const $room = <
  TClient extends TWSObject,
  TServer extends TWSObject,
  TState = undefined,
>(
  options: RoomPrimitiveOptions<TClient, TServer, TState>,
): RoomPrimitive<TClient, TServer, TState> => {
  return createPrimitive(RoomPrimitive<TClient, TServer, TState>, options);
};

// ---------------------------------------------------------------------------------------------------------------------

export class RoomPrimitive<
  TClient extends TWSObject,
  TServer extends TWSObject,
  TState,
> extends Primitive<RoomPrimitiveOptions<TClient, TServer, TState>> {
  protected readonly webSocketServerProvider = $inject(WebSocketServerProvider);

  protected onInit() {
    this.webSocketServerProvider.registerRoom(this.options);
  }

  protected get path(): string {
    return this.options.channel.options.path;
  }

  /**
   * Invoke a server-side method on one room (by id), from outside it. On
   * Cloudflare this is a Durable Object RPC; on Node it is a direct call. The
   * room comes to life lazily on its first call.
   */
  public async call(
    roomId: string,
    method: string,
    ...args: unknown[]
  ): Promise<unknown> {
    return this.webSocketServerProvider.callRoom(
      this.path,
      roomId,
      method,
      args,
    );
  }

  /**
   * Push a server-initiated message to every socket in one live room. A no-op
   * if that room currently holds no connections.
   */
  public async broadcast(
    roomId: string,
    message: unknown,
    options?: { exceptConnectionIds?: string[] },
  ): Promise<void> {
    return this.webSocketServerProvider.broadcastToRoom(
      this.path,
      roomId,
      message,
      options,
    );
  }
}

$room[KIND] = RoomPrimitive;
