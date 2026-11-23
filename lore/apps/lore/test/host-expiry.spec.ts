import { projectEvents, HostExpiryJobs, HostController } from "@lore/core/api";
import { hosts } from "@lore/core/schemas";
import { createTestHost } from "@lore/core/testing/hosts";
import { LoreShipApi } from "@lore/ship/api";
import { DeployTestEntities } from "@lore/ship/testing";
import { Alepha } from "alepha";
import { AlephaApiUsers } from "alepha/api/users";
import { DateTimeProvider } from "alepha/datetime";
import { AlephaEmail, MemoryEmailProvider } from "alepha/email";
import { $repository, AlephaOrm } from "alepha/orm";
import type { UserAccountToken } from "alepha/security";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { afterEach, beforeEach, describe, it } from "vitest";

class HostRepositories {
  hosts = $repository(hosts);
}

/**
 * The project events (#Q3889), what a host source records.
 */
class ProjectEventRows {
  events = $repository(projectEvents);
}

/**
 * A throwaway host's TTL (#Q3138): `ttlSeconds` on `updateHost` sets the
 * expiry from Lore's clock, `overdue` is derived at read time, and the sweep
 * tells the owner once, re-armed when the TTL moves. Nothing is stopped or
 * deleted.
 *
 * The sweep is called directly rather than through `travel()`, which would
 * release every cron in the container.
 */
describe("host expiry", () => {
  let alepha: Alepha;
  let controller: HostController;
  let entities: DeployTestEntities;
  let repos: HostRepositories;
  let mail: MemoryEmailProvider;
  let dateTime: DateTimeProvider;

  beforeEach(async () => {
    alepha = Alepha.create({
      env: {
        LOG_LEVEL: "error",
        DATABASE_URL: ":memory:",
        APP_SECRET: "host-expiry-spec-secret",
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
    controller = alepha.inject(HostController);
    mail = alepha.inject(MemoryEmailProvider);
    dateTime = alepha.inject(DateTimeProvider);
  });

  afterEach(async () => {
    await alepha.stop();
  });

  const owner = async (): Promise<UserAccountToken> => {
    const user = await entities.users.create({ email: "owner@example.com" });
    return { id: user.id, roles: ["user"] };
  };

  it("sets the expiry from a TTL, reads overdue once past it, and clears it with null", async ({
    expect,
  }) => {
    const user = await owner();
    const minted = await createTestHost(alepha, user, { slug: "tmp-1" });

    const set = await controller.updateHost(
      { params: { hostId: minted.id }, body: { ttlSeconds: 7200 } },
      { user },
    );
    expect(Date.parse(set.expiresAt!) - dateTime.nowMillis()).toBeGreaterThan(
      7_100_000,
    );
    expect(set.overdue).toBe(false);

    await repos.hosts.updateById(minted.id, {
      expiresAt: new Date(dateTime.nowMillis() - 1000).toISOString(),
    });
    const late = await controller.getHost(
      { params: { hostId: minted.id } },
      { user },
    );
    expect(late.overdue).toBe(true);

    const cleared = await controller.updateHost(
      { params: { hostId: minted.id }, body: { ttlSeconds: null } },
      { user },
    );
    expect(cleared.expiresAt).toBeUndefined();
    expect(cleared.overdue).toBe(false);
  });

  it("raises host.expired once, again only after the TTL moves, and deletes nothing", async ({
    expect,
  }) => {
    const user = await owner();
    const minted = await createTestHost(alepha, user, { slug: "tmp-2" });
    await repos.hosts.updateById(minted.id, {
      expiresAt: new Date(dateTime.nowMillis() - 1000).toISOString(),
    });
    const sweep = alepha.inject(HostExpiryJobs);

    expect(await sweep.sweep()).toBe(1);
    expect(await sweep.sweep()).toBe(0);
    // Raised as host.expired in the home project (#Q3627): nobody is
    // emailed directly any more.
    const events = () =>
      alepha.inject(ProjectEventRows).events.findMany({
        where: { name: "host.expired" },
      });
    const [event] = await events();
    expect(event.projectId).toBe(minted.projectId);
    expect(event.fields).toMatchObject({ host: "tmp-2", kind: "bay" });
    // The link opens the console under the host's home project: hosts
    // have no account page since #E126.
    expect(String(event.fields.url)).toMatch(/^\/[a-z0-9-]+\/hosts\/tmp-2$/);
    expect(mail.records).toHaveLength(0);

    // Extending re-arms; once that expiry passes too, one more.
    await controller.updateHost(
      { params: { hostId: minted.id }, body: { ttlSeconds: 60 } },
      { user },
    );
    expect(await sweep.sweep()).toBe(0);
    await repos.hosts.updateById(minted.id, {
      expiresAt: new Date(dateTime.nowMillis() - 1000).toISOString(),
    });
    expect(await sweep.sweep()).toBe(1);
    expect(await events()).toHaveLength(2);

    // Lore stops and deletes nothing.
    expect(await repos.hosts.findById(minted.id)).toBeDefined();
  });
});
