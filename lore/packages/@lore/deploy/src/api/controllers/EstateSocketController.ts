import { $inject } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $logger } from "alepha/logger";
import { $repository } from "alepha/orm";
import { $channel, $websocket } from "alepha/websocket";

import { type Estate, estates } from "../entities/estates.ts";
import { estateClientFrameSchema } from "../schemas/estateClientFrameSchema.ts";
import { estateServerFrameSchema } from "../schemas/estateServerFrameSchema.ts";
import { EstateCommandService } from "../services/EstateCommandService.ts";
import { EstateEventService } from "../services/EstateEventService.ts";
import { EstateInventoryService } from "../services/EstateInventoryService.ts";
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
 * arriving after a reconnect, does not mark the new connection offline: the
 * close is one write conditioned on it, connect and hello each `claim` the
 * row, and every stats frame pushes what is still `pending`, so a command
 * queued while the row read offline waits one heartbeat, not a restart.
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
  protected readonly inventories = $inject(EstateInventoryService);
  protected readonly events = $inject(EstateEventService);
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
    authorize: async ({ headers, ip }) => {
      const estate = await this.tokens.verify(
        this.tokens.bearer(headers.authorization),
      );
      if (!estate) {
        return undefined;
      }
      // The handshake is the one place the connecting address is readable
      // (#Q3137); `onConnect` gets no headers. Written only when it moved.
      const publicIp = this.publicIpOf(ip);
      if (publicIp && publicIp !== estate.publicIp) {
        await this.estates.updateById(estate.id, { publicIp });
      }
      // The first dial with a long-lived secret retires the enrolment secret
      // it was exchanged for (#Q3165): from here the one in user data is dead.
      if (estate.enrolmentHash) {
        await this.estates.updateById(estate.id, {
          enrolmentHash: null,
          enrolmentExpiresAt: null,
        });
      }
      return { roomId: estate.id };
    },
    onConnect: async ({ connectionId, roomIds }) => {
      const estateId = roomIds[0];
      if (!estateId) return;
      await this.claim(estateId, connectionId);
    },
    onDisconnect: async ({ connectionId, roomIds }) => {
      const estateId = roomIds[0];
      if (!estateId) return;
      // ONE conditional write, never a read then a write: a close of an
      // older socket, delivered late, used to read the row before the
      // reconnect stamped it and write after, so the row read offline while
      // the new socket was live (estate `ovh`, 2026-11-07). Matching on the
      // connection id in the write itself means a close can only ever mark
      // the socket it belongs to.
      await this.estates.updateMany(
        { id: { eq: estateId }, connectionId: { eq: connectionId } },
        { disconnectedAt: this.now() },
      );
    },
    handler: async ({ connectionId, roomId, message, reply }) => {
      const estate = await this.estateOf(roomId);
      if (!estate) return;

      if (message.type === "hello") {
        // A hello proves this socket is the live one: a row a lost race left
        // naming another socket, or stamped offline, heals here at once.
        await this.claim(estate.id, connectionId);
        await reply({ message: this.service.welcomeFrame(estate, "welcome") });
        // The reconciliation: everything unacknowledged goes out again under
        // the same ids. This is what caps a lost-in-transit command at
        // "however long the outage lasted".
        for (const command of await this.commands.pendingFor(estate.id)) {
          await this.commands.markSent(command);
          await reply({ message: this.commands.frameOf(command) });
        }
        return;
      }
      await this.estates.updateById(estate.id, { lastSeenAt: this.now() });
      if (message.type === "ack") {
        await this.commands.ack(estate.id, message);
        return;
      }
      if (message.type === "inventory") {
        await this.inventories.record(estate, message);
        return;
      }
      if (message.type === "event") {
        await this.events.record(estate, message);
        return;
      }
      await this.stats.record(estate, message);
      // The heartbeat is also the redelivery: a command queued while the row
      // read offline was left `pending` by the transport, and would otherwise
      // wait for the next hello, which is the machine's next restart. Only
      // `pending` ones: a `sent` command may be running, and the hello is
      // what re-sends those.
      for (const command of await this.commands.pendingFor(estate.id)) {
        if (command.status !== "pending") continue;
        await this.commands.markSent(command);
        await reply({ message: this.commands.frameOf(command) });
      }
    },
  });

  /**
   * Stamps the row as held by this socket, in one write: the connection id,
   * the connect and last-seen stamps, and `disconnectedAt` cleared, so no
   * earlier close can outrank it on equal timestamps (a Worker's clock is
   * frozen during I/O). Used on connect and again on the machine's hello.
   */
  protected async claim(estateId: string, connectionId: string): Promise<void> {
    const now = this.now();
    await this.estates.updateMany(
      { id: { eq: estateId } },
      {
        connectedAt: now,
        lastSeenAt: now,
        connectionId,
        disconnectedAt: null,
      },
    );
  }

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

  /**
   * The address a machine connects from, as the engine reports it (the
   * socket's on Node, `cf-connecting-ip` on Cloudflare), kept only when it
   * reads as an IP.
   */
  protected publicIpOf(raw: string | undefined): string | undefined {
    const ip = raw?.trim();
    if (!ip || ip.length > 45) {
      return undefined;
    }
    return /^[0-9.]+$|^[0-9a-f:]+$/i.test(ip) ? ip : undefined;
  }
}
