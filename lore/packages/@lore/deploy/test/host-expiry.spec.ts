import { Alepha } from "alepha";
import { AlephaApiUsers } from "alepha/api/users";
import { DateTimeProvider } from "alepha/datetime";
import { AlephaEmail, MemoryEmailProvider } from "alepha/email";
import { $repository, AlephaOrm } from "alepha/orm";
import type { UserAccountToken } from "alepha/security";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { afterEach, beforeEach, describe, it } from "vitest";

import {
  HostController,
  HostExpiryJobs,
  LoreDeployApi,
} from "../src/api/index.ts";
import { hosts } from "../src/schemas/index.ts";
import { createTestHost } from "../src/testing/hosts.ts";
import { DeployTestEntities } from "../src/testing/index.ts";

class HostRepositories {
  hosts = $repository(hosts);
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
    alepha.with(LoreDeployApi);
    entities = alepha.inject(DeployTestEntities);
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

  it("tells the owner once, again only after the TTL moves, and deletes nothing", async ({
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
    // Queued, not inline: wait for the positive signal before reading it.
    const deadline = Date.now() + 5000;
    while (mail.records.length === 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(mail.records).toHaveLength(1);
    expect(mail.records[0]!.to).toBe("owner@example.com");
    expect(mail.records[0]!.body).toContain("tmp-2");
    // The link opens the console under the host's home project: hosts
    // have no account page since #E126.
    expect(mail.records[0]!.body).toMatch(/\/[a-z0-9-]+\/hosts\/tmp-2"/);
    expect(mail.records[0]!.body).not.toContain("/account/hosts");

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

    // Lore stops and deletes nothing.
    expect(await repos.hosts.findById(minted.id)).toBeDefined();
  });
});
