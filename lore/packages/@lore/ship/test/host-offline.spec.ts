import { projectEvents, HostOfflineJobs } from "@lore/core/api";
import { hosts } from "@lore/core/schemas";
import { createTestHost } from "@lore/core/testing/hosts";
import { Alepha } from "alepha";
import { AlephaApiUsers } from "alepha/api/users";
import { DateTimeProvider } from "alepha/datetime";
import { AlephaEmail } from "alepha/email";
import { $repository, AlephaOrm } from "alepha/orm";
import type { UserAccountToken } from "alepha/security";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { afterEach, beforeEach, describe, it } from "vitest";

import { LoreShipApi } from "../src/api/index.ts";
import { DeployTestEntities } from "../src/testing/index.ts";

class HostRepositories {
  hosts = $repository(hosts);
  projectEvents = $repository(projectEvents);
}

/**
 * The project events (#Q3889), what a host source records.
 */
class ProjectEventRows {
  events = $repository(projectEvents);
}

/**
 * A Bay host that stops reporting (#Q3733): one `host.offline` per outage
 * once it has been gone past the grace period, one `host.online` when it is
 * back, and nothing for a restart that reconnects within the grace period.
 *
 * The row's stamps are written as the socket writes them (connect, close,
 * last frame), dated against Lore's clock, and the sweep is called directly
 * rather than through `travel()`, which would release every cron.
 */
describe("host offline", () => {
  let alepha: Alepha;
  let entities: DeployTestEntities;
  let repos: HostRepositories;
  let dateTime: DateTimeProvider;
  let sweep: HostOfflineJobs;

  beforeEach(async () => {
    alepha = Alepha.create({
      env: {
        DATABASE_URL: ":memory:",
        APP_SECRET: "host-offline-spec-secret",
      },
    });
    alepha.with(AlephaOrm);
    alepha.with(AlephaServer);
    alepha.with(AlephaSecurity);
    alepha.with(AlephaEmail);
    alepha.with(AlephaApiUsers);
    alepha.with(LoreShipApi);
    entities = alepha.inject(DeployTestEntities);
    alepha.inject(ProjectEventRows);
    repos = alepha.inject(HostRepositories);
    await alepha.start();
    dateTime = alepha.inject(DateTimeProvider);
    // One frozen now, so a stamp written and the one read back agree.
    dateTime.pause();
    sweep = alepha.inject(HostOfflineJobs);
  });

  afterEach(async () => {
    await alepha.stop();
  });

  const owner = async (): Promise<UserAccountToken> => {
    const user = await entities.users.create({ email: "owner@example.com" });
    return { id: user.id, roles: ["user"] };
  };

  /** An ISO stamp `minutes` before Lore's now. */
  const ago = (minutes: number) =>
    new Date(dateTime.nowMillis() - minutes * 60_000).toISOString();

  const events = (name: "host.offline" | "host.online") =>
    alepha.inject(ProjectEventRows).events.findMany({ where: { name } });

  it("raises host.offline once past the grace period, and host.online once it is back", async ({
    expect,
  }) => {
    const user = await owner();
    const host = await createTestHost(alepha, user, { slug: "ci-box" });
    // Connected an hour ago, closed six minutes ago.
    await repos.hosts.updateById(host.id, {
      connectedAt: ago(60),
      lastSeenAt: ago(7),
      connectionId: "socket-1",
      disconnectedAt: ago(6),
    });

    expect(await sweep.sweep()).toEqual({ offline: 1, online: 0 });
    // One per outage: still down, nothing more.
    expect(await sweep.sweep()).toEqual({ offline: 0, online: 0 });
    const [offline] = await events("host.offline");
    expect(offline.projectId).toBe(host.projectId);
    expect(offline.fields).toMatchObject({
      host: "ci-box",
      kind: "bay",
      since: ago(6),
      title: "ci-box",
    });

    // The machine dials back in, as `HostSocketController.claim` stamps it.
    await repos.hosts.updateById(host.id, {
      connectedAt: ago(0),
      lastSeenAt: ago(0),
      connectionId: "socket-2",
      disconnectedAt: null,
    });
    expect(await sweep.sweep()).toEqual({ offline: 0, online: 1 });
    expect(await sweep.sweep()).toEqual({ offline: 0, online: 0 });
    const [online] = await events("host.online");
    expect(online.fields).toMatchObject({
      host: "ci-box",
      since: offline.fields.since,
      title: "ci-box",
    });
    expect((await repos.hosts.findById(host.id))?.offlineSince).toBeUndefined();

    // The project events of #Q3889: the same two facts, as data. The title
    // is the host's slug, never a sentence.
    // The clock is paused, so both share one instant: order by name.
    const recorded = (
      await repos.projectEvents.findMany({
        where: { projectId: host.projectId },
      })
    ).sort((a, b) => a.name.localeCompare(b.name));
    expect(recorded.map((event) => event.name)).toEqual([
      "host.offline",
      "host.online",
    ]);
    expect(recorded[0]).toMatchObject({
      subjectKind: "host",
      subjectId: host.id,
      fields: {
        host_id: host.id,
        host: "ci-box",
        kind: "bay",
        state: "offline",
        title: "ci-box",
        since: ago(6),
      },
    });
  });

  it("raises nothing for a restart that reconnects within the grace period", async ({
    expect,
  }) => {
    const user = await owner();
    const host = await createTestHost(alepha, user, { slug: "restarting" });
    // Closed two minutes ago: a Bay upgrade in progress.
    await repos.hosts.updateById(host.id, {
      connectedAt: ago(60),
      lastSeenAt: ago(2),
      connectionId: "socket-1",
      disconnectedAt: ago(2),
    });
    expect(await sweep.sweep()).toEqual({ offline: 0, online: 0 });

    // Back within the grace period: the next sweeps see a live host.
    await repos.hosts.updateById(host.id, {
      connectedAt: ago(1),
      lastSeenAt: ago(1),
      connectionId: "socket-2",
      disconnectedAt: null,
    });
    expect(await sweep.sweep()).toEqual({ offline: 0, online: 0 });
    expect(await events("host.offline")).toHaveLength(0);
    expect(await events("host.online")).toHaveLength(0);
  });

  it("dates a lost close from the silence, and skips a host past its TTL or never connected", async ({
    expect,
  }) => {
    const user = await owner();
    // No close was recorded, but nothing came for far longer than twice the
    // stats interval (1800 s): offline since lastSeen + 60 minutes.
    const silent = await createTestHost(alepha, user, { slug: "silent" });
    await repos.hosts.updateById(silent.id, {
      connectedAt: ago(200),
      lastSeenAt: ago(120),
      connectionId: "socket-1",
    });
    // Gone, but a throwaway host past its TTL: expected to go.
    const throwaway = await createTestHost(alepha, user, { slug: "tmp" });
    await repos.hosts.updateById(throwaway.id, {
      connectedAt: ago(60),
      disconnectedAt: ago(30),
      expiresAt: ago(31),
    });
    // Enrolled and never dialled in.
    await createTestHost(alepha, user, { slug: "fresh" });

    expect(await sweep.sweep()).toEqual({ offline: 1, online: 0 });
    const [event] = await events("host.offline");
    expect(event.fields).toMatchObject({
      host: "silent",
      since: ago(60),
    });
  });
});
