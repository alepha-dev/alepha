import { $inject } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $logger } from "alepha/logger";
import { $repository } from "alepha/orm";
import { $channel, $websocket } from "alepha/websocket";

import { type Estate, estates } from "../entities/estates.ts";
import { estateClientFrameSchema } from "../schemas/estateClientFrameSchema.ts";
import { estateServerFrameSchema } from "../schemas/estateServerFrameSchema.ts";
import { EstateCommandService } from "../services/EstateCommandService.ts";
import { EstateService } from "../services/EstateService.ts";
import { EstateStatsService } from "../services/EstateStatsService.ts";
import { EstateTokenService } from "../services/EstateTokenService.ts";

/**
 * The websocket a Bay machine dials into and holds open.
 *
 * ## One room per estate, named by the credential
 *
 * The handshake carries the estate secret as a bearer. `authorize` resolves
 * it through `EstateTokenService` and returns the estate's id as the room:
 * the URL's `?roomId=` is ignored, and the connection carries no `userId`.
 * That is the invariant "the secret authenticates a machine, not its owner"
 * made structural: the connection can never be reached by `emit({ userId })`
 * and holds nothing a session holds. A bad secret and an unknown estate
 * refuse identically, with a 401 before any socket exists.
 *
 * Room = estate id is not a convenience. On Cloudflare the provider's `emit`
 * is room-targeted only, so it is the one address that works.
 *
 * ## Why the machine speaks first
 *
 * On production this handler runs INSIDE the Durable Object that holds the
 * socket. A handler can `reply()` into its own room as a local fan-out;
 * `onConnect` has no reply, and an `emit()` from inside the object would be
 * the object calling its own stub. So `onConnect` only stamps the row, and
 * the machine's `hello` is what Lore answers with `welcome` plus everything
 * queued for it. Same code path on Node.
 *
 * ## Liveness, on the row
 *
 * The estate list is rendered by the Worker, which cannot see sockets that
 * live in a Durable Object. So the connection stamps `connectedAt`,
 * `disconnectedAt` and `lastSeenAt`, and `EstateService.isOnline` derives
 * the answer. `connectionId` is kept so a stale close of an OLDER socket,
 * arriving after a reconnect, does not mark the new connection offline.
 *
 * ## Keepalive costs nothing
 *
 * Only the Node provider pings; the Durable Object never does. The machine
 * pings instead (#1620), with protocol-level ping frames, and Cloudflare's
 * runtime answers those itself without waking a hibernated object and
 * without calling the message handler. Verified against the Durable Objects
 * websocket documentation on 2026-09-04: no auto-response pair is needed.
 */
export class EstateSocketController {
  /**
   * The channel path. The connector derives `wss://<lore>` + this from the
   * origin it was given.
   */
  public static readonly PATH = "/ws/estates";

  protected readonly log = $logger();
  protected readonly estates = $repository(estates);
  protected readonly tokens = $inject(EstateTokenService);
  protected readonly service = $inject(EstateService);
  protected readonly commands = $inject(EstateCommandService);
  protected readonly stats = $inject(EstateStatsService);
  protected readonly dateTime = $inject(DateTimeProvider);

  channel = $channel({
    path: EstateSocketController.PATH,
    description: "The connection a Bay estate holds open to Lore",
    schema: {
      in: estateServerFrameSchema,
      out: estateClientFrameSchema,
    },
  });

  socket = $websocket({
    channel: this.channel,
    authorize: async ({ headers }) => {
      const estate = await this.tokens.verify(
        this.tokens.bearer(headers.authorization),
      );
      return estate ? { roomId: estate.id } : undefined;
    },
    onConnect: async ({ connectionId, roomIds }) => {
      const estate = await this.estateOf(roomIds[0]);
      if (!estate) return;
      const now = this.now();
      await this.estates.updateById(estate.id, {
        connectedAt: now,
        lastSeenAt: now,
        connectionId,
      });
    },
    onDisconnect: async ({ connectionId, roomIds }) => {
      const estate = await this.estateOf(roomIds[0]);
      if (!estate) return;
      // A close for an older socket, arriving after a reconnect, says nothing
      // about the connection that replaced it.
      if (estate.connectionId && estate.connectionId !== connectionId) return;
      await this.estates.updateById(estate.id, { disconnectedAt: this.now() });
    },
    handler: async ({ roomId, message, reply }) => {
      const estate = await this.estateOf(roomId);
      if (!estate) return;
      await this.estates.updateById(estate.id, { lastSeenAt: this.now() });

      if (message.type === "hello") {
        await reply({ message: this.service.welcomeFrame(estate, "welcome") });
        // The reconciliation: everything unacknowledged goes out again under
        // the same ids. This is what caps a lost-in-transit command at
        // "however long the outage lasted".
        for (const command of await this.commands.pendingFor(estate.id)) {
          await reply({ message: this.commands.frameOf(command) });
          await this.commands.markSent(command);
        }
        return;
      }
      if (message.type === "ack") {
        await this.commands.ack(estate.id, message);
        return;
      }
      if (message.type === "inventory") {
        // Accepted and validated from the moment the schema lands, so a
        // machine already pushing one is never refused. Stored by
        // `EstateInventoryService` (#Q1897), which is the next quest.
        return;
      }
      await this.stats.record(estate, message);
    },
  });

  protected async estateOf(
    id: string | undefined,
  ): Promise<Estate | undefined> {
    if (!id) return undefined;
    const estate = await this.estates.findOne({ where: { id: { eq: id } } });
    if (!estate) {
      // Deleted between the handshake and now: the socket has nothing to
      // belong to, and the next dial is refused at the handshake.
      this.log.warn("A socket is open for an estate that no longer exists", {
        estateId: id,
      });
    }
    return estate;
  }

  protected now(): string {
    return new Date(this.dateTime.nowMillis()).toISOString();
  }
}
