import {
  HostStatsService,
  HostController,
  ProjectHostController,
} from "@lore/core/api";
import { HostTools } from "@lore/core/mcp";
import { hosts } from "@lore/core/schemas";
import { createTestHost } from "@lore/core/testing/hosts";
import { LoreShipApi } from "@lore/ship/api";
import { LoreShipMcp } from "@lore/ship/mcp";
import { DeployTestEntities } from "@lore/ship/testing";
import { Alepha } from "alepha";
import { AlephaApiUsers } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { AlephaMcp } from "alepha/mcp";
import { $repository, AlephaOrm } from "alepha/orm";
import { currentUserAtom, AlephaSecurity } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { afterEach, beforeEach, describe, it } from "vitest";

class HostRepositories {
  hosts = $repository(hosts);
}

/**
 * `host_stats` (#Q3047): one of the caller's own hosts, its gauge and its
 * daily means, through the owner-only action, so another owner's host is
 * as unknown as one that does not exist.
 */
describe("host MCP tools", () => {
  let alepha: Alepha;
  let entities: DeployTestEntities;
  let repos: HostRepositories;

  beforeEach(async () => {
    alepha = Alepha.create({
      env: { LOG_LEVEL: "error", DATABASE_URL: ":memory:" },
    });
    alepha.with(AlephaOrm);
    alepha.with(AlephaServer);
    alepha.with(AlephaSecurity);
    alepha.with(AlephaEmail);
    alepha.with(AlephaApiUsers);
    alepha.with(AlephaMcp);
    alepha.with(LoreShipApi);
    alepha.with(LoreShipMcp);
    entities = alepha.inject(DeployTestEntities);
    repos = alepha.inject(HostRepositories);
    await alepha.start();
  });

  afterEach(async () => {
    await alepha.stop();
  });

  const newUser = async () => {
    const user = await entities.users.create({});
    return { id: user.id, roles: ["user"] };
  };

  const stats = (user: { id: string }, params: Record<string, unknown>) =>
    alepha.context.run(() => {
      alepha.store.set(currentUserAtom, user);
      return (
        alepha.inject(HostTools).host_stats as unknown as {
          execute: (p: unknown) => Promise<any>;
        }
      ).execute(params);
    });

  const arrange = async () => {
    const owner = await newUser();
    const minted = await createTestHost(alepha, owner, { slug: "vps-ovh" });
    const repo = repos.hosts;
    await repo.updateById(minted.id, { collectSeries: true });
    const row = await repo.getOne({ where: { id: { eq: minted.id } } });
    const service = alepha.inject(HostStatsService);
    for (const [cpu, memory] of [
      [20, 10],
      [40, 30],
    ]) {
      await service.record(row, {
        type: "stats",
        cpuPercent: cpu,
        memoryPercent: memory,
        at: "2001-01-01T00:00:00.000Z",
      });
    }
    return { owner };
  };

  it("answers the owner the current reading and the daily means", async ({
    expect,
  }) => {
    const { owner } = await arrange();

    const result = await stats(owner, { host: "vps-ovh" });

    expect(result.host).toBe("vps-ovh");
    expect(result.current).toMatchObject({ cpuPercent: 40, memoryPercent: 30 });
    expect(result.collecting).toBe(true);
    expect(result.points).toHaveLength(1);
    expect(result.points[0]).toMatchObject({
      cpuPercent: 30,
      memoryPercent: 20,
      samples: 2,
    });
  });

  it("knows no host of a project the caller is not in, by the same answer as a missing one", async ({
    expect,
  }) => {
    await arrange();
    const stranger = await newUser();

    await expect(stats(stranger, { host: "vps-ovh" })).rejects.toThrow(
      "No host named vps-ovh that you can read",
    );
  });

  it("refuses a slug two readable hosts share, and home picks one", async ({
    expect,
  }) => {
    const { owner } = await arrange();
    // A second project of the same owner, with its own vps-ovh: a slug is
    // unique per home project (#E126).
    const second = await createTestHost(alepha, owner, { slug: "vps-ovh" });
    const home = await alepha
      .inject(ProjectHostController)
      .listHomeHosts(
        { params: { projectId: second.projectId } },
        { user: owner },
      );
    const homeSlug = home.items[0]!.project!.slug!;

    await expect(stats(owner, { host: "vps-ovh" })).rejects.toThrow(
      /Several hosts are named vps-ovh.*Pass home/,
    );
    const picked = await stats(owner, { host: "vps-ovh", home: homeSlug });
    expect(picked.collecting).toBe(false);
    const narrowed = await stats(owner, {
      host: "vps-ovh",
      project: second.projectId,
    });
    expect(narrowed.collecting).toBe(false);
  });

  it("reports collecting once the CLI's --stats-history body is applied (#Q3734)", async ({
    expect,
  }) => {
    const owner = await newUser();
    const minted = await createTestHost(alepha, owner, { slug: "shell-box" });
    expect((await stats(owner, { host: "shell-box" })).collecting).toBe(false);

    // What `lore host update shell-box --stats-history --stats-interval 5m`
    // sends.
    const updated = await alepha.inject(HostController).updateHost(
      {
        params: { hostId: minted.id },
        body: { collectSeries: true, statsIntervalSeconds: 300 },
      },
      { user: owner },
    );
    expect(updated).toMatchObject({
      collectSeries: true,
      statsIntervalSeconds: 300,
    });
    expect((await stats(owner, { host: "shell-box" })).collecting).toBe(true);
  });
});
