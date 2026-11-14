import { $inject } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $logger } from "alepha/logger";
import { $repository } from "alepha/orm";
import { $channel, $websocket } from "alepha/websocket";

import { type Host, hosts } from "../entities/hosts.ts";
import { hostClientFrameSchema } from "../schemas/hostClientFrameSchema.ts";
import { hostServerFrameSchema } from "../schemas/hostServerFrameSchema.ts";
import { HostCommandService } from "../services/HostCommandService.ts";
import { HostEventService } from "../services/HostEventService.ts";
import { HostInventoryService } from "../services/HostInventoryService.ts";
import { HostService } from "../services/HostService.ts";
import { HostStatsService } from "../services/HostStatsService.ts";
import { HostTokenService } from "../services/HostTokenService.ts";

/**
 * The websocket a Bay machine dials into and holds open.
 *
 * ## One room per host, named by the credential
 *
 * The handshake carries the host secret as a bearer. `authorize` resolves
 * it through `HostTokenService` and returns the host's id as the room:
 * the URL's `?roomId=` is ignored, and the connection carries no `userId`.
 * That is the invariant "the secret authenticates a machine, not its owner"
 * made structural: the connection can never be reached by `emit({ userId })`
 * and holds nothing a session holds. A bad secret and an unknown host
 * refuse identically, with a 401 before any socket exists.
 *
 * Room = host id is not a convenience. On Cloudflare the provider's `emit`
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
 * The host list is rendered by the Worker, which cannot see sockets that
 * live in a Durable Object. So the connection stamps `connectedAt`,
 * `disconnectedAt` and `lastSeenAt`, and `HostService.isOnline` derives
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
export class HostSocketController {
  /**
   * The channel path. The connector derives `wss://<lore>` + this from the
   * origin it was given.
   *
   * Bay wire v1: keeps the word Lore used before #E147, because every running Bay dials it
   * (`SocketPath` in `config.go`) and a new spelling would need a binary swap on every host.
   */
  public static readonly PATH = "/ws/estates";

  protected readonly log = $logger();
  protected readonly hosts = $repository(hosts);
  protected readonly tokens = $inject(HostTokenService);
  protected readonly service = $inject(HostService);
  protected readonly commands = $inject(HostCommandService);
  protected readonly stats = $inject(HostStatsService);
  protected readonly inventories = $inject(HostInventoryService);
  protected readonly events = $inject(HostEventService);
  protected readonly dateTime = $inject(DateTimeProvider);

  channel = $channel({
    path: HostSocketController.PATH,
    description: "The connection a Bay host holds open to Lore",
    schema: {
      in: hostServerFrameSchema,
      out: hostClientFrameSchema,
    },
  });

  socket = $websocket({
    channel: this.channel,
    authorize: async ({ headers, ip }) => {
      const host = await this.tokens.verify(
        this.tokens.bearer(headers.authorization),
      );
      if (!host) {
        return undefined;
      }
      // The handshake is the one place the connecting address is readable
      // (#Q3137); `onConnect` gets no headers. Written only when it moved.
      const publicIp = this.publicIpOf(ip);
      if (publicIp && publicIp !== host.publicIp) {
        await this.hosts.updateById(host.id, { publicIp });
      }
      // The first dial with a long-lived secret retires the enrolment secret
      // it was exchanged for (#Q3165): from here the one in user data is dead.
      if (host.enrolmentHash) {
        await this.hosts.updateById(host.id, {
          enrolmentHash: null,
          enrolmentExpiresAt: null,
        });
      }
      return { roomId: host.id };
    },
    onConnect: async ({ connectionId, roomIds }) => {
      const hostId = roomIds[0];
      if (!hostId) return;
      await this.claim(hostId, connectionId);
    },
    onDisconnect: async ({ connectionId, roomIds }) => {
      const hostId = roomIds[0];
      if (!hostId) return;
      // ONE conditional write, never a read then a write: a close of an
      // older socket, delivered late, used to read the row before the
      // reconnect stamped it and write after, so the row read offline while
      // the new socket was live (host `ovh`, 2026-11-07). Matching on the
      // connection id in the write itself means a close can only ever mark
      // the socket it belongs to.
      await this.hosts.updateMany(
        { id: { eq: hostId }, connectionId: { eq: connectionId } },
        { disconnectedAt: this.now() },
      );
    },
    handler: async ({ connectionId, roomId, message, reply }) => {
      const host = await this.hostOf(roomId);
      if (!host) return;

      if (message.type === "hello") {
        // A hello proves this socket is the live one: a row a lost race left
        // naming another socket, or stamped offline, heals here at once.
        await this.claim(host.id, connectionId);
        await reply({ message: this.service.welcomeFrame(host, "welcome") });
        // The reconciliation: everything unacknowledged goes out again under
        // the same ids. This is what caps a lost-in-transit command at
        // "however long the outage lasted".
        for (const command of await this.commands.pendingFor(host.id)) {
          await this.commands.markSent(command);
          await reply({ message: this.commands.frameOf(command) });
        }
        return;
      }
      await this.hosts.updateById(host.id, { lastSeenAt: this.now() });
      if (message.type === "ack") {
        await this.commands.ack(host.id, message);
        return;
      }
      if (message.type === "inventory") {
        await this.inventories.record(host, message);
        return;
      }
      if (message.type === "event") {
        await this.events.record(host, message);
        return;
      }
      await this.stats.record(host, message);
      // The heartbeat is also the redelivery: a command queued while the row
      // read offline was left `pending` by the transport, and would otherwise
      // wait for the next hello, which is the machine's next restart. Only
      // `pending` ones: a `sent` command may be running, and the hello is
      // what re-sends those.
      for (const command of await this.commands.pendingFor(host.id)) {
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
  protected async claim(hostId: string, connectionId: string): Promise<void> {
    const now = this.now();
    await this.hosts.updateMany(
      { id: { eq: hostId } },
      {
        connectedAt: now,
        lastSeenAt: now,
        connectionId,
        disconnectedAt: null,
      },
    );
  }

  protected async hostOf(id: string | undefined): Promise<Host | undefined> {
    if (!id) return undefined;
    const host = await this.hosts.findOne({ where: { id: { eq: id } } });
    if (!host) {
      // Deleted between the handshake and now: the socket has nothing to
      // belong to, and the next dial is refused at the handshake.
      this.log.warn("A socket is open for a host that no longer exists", {
        hostId: id,
      });
    }
    return host;
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
