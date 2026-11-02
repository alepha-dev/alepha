import { Alepha } from "alepha";
import { AlephaApiUsers } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { AlephaMcp } from "alepha/mcp";
import { $repository, AlephaOrm } from "alepha/orm";
import { currentUserAtom } from "alepha/security";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { afterEach, beforeEach, describe, it } from "vitest";

import {
  EstateController,
  EstateStatsService,
  LoreDeployApi,
} from "../src/api/index.ts";
import { EstateTools, LoreDeployMcp } from "../src/mcp/index.ts";
import { estates } from "../src/schemas/index.ts";
import { DeployTestEntities } from "../src/testing/index.ts";

class EstateRepositories {
  estates = $repository(estates);
}

/**
 * `estate_stats` (#Q3047): one of the caller's own estates, its gauge and its
 * daily means, through the owner-only action, so another owner's estate is
 * as unknown as one that does not exist.
 */
describe("estate MCP tools", () => {
  let alepha: Alepha;
  let entities: DeployTestEntities;
  let repos: EstateRepositories;

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
    alepha.with(LoreDeployApi);
    alepha.with(LoreDeployMcp);
    entities = alepha.inject(DeployTestEntities);
    repos = alepha.inject(EstateRepositories);
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
      alepha.store.set(currentUserAtom, user as never);
      return (
        alepha.inject(EstateTools).estate_stats as unknown as {
          execute: (p: unknown) => Promise<any>;
        }
      ).execute(params);
    });

  const arrange = async () => {
    const owner = await newUser();
    const minted = await alepha
      .inject(EstateController)
      .createEstate({ body: { slug: "vps-ovh" } }, { user: owner });
    const repo = repos.estates;
    await repo.updateById(minted.id, { collectSeries: true });
    const row = await repo.getOne({ where: { id: { eq: minted.id } } });
    const service = alepha.inject(EstateStatsService);
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

    const result = await stats(owner, { estate: "vps-ovh" });

    expect(result.estate).toBe("vps-ovh");
    expect(result.current).toMatchObject({ cpuPercent: 40, memoryPercent: 30 });
    expect(result.collecting).toBe(true);
    expect(result.points).toHaveLength(1);
    expect(result.points[0]).toMatchObject({
      cpuPercent: 30,
      memoryPercent: 20,
      samples: 2,
    });
  });

  it("knows no estate of another owner, by the same answer as a missing one", async ({
    expect,
  }) => {
    await arrange();
    const stranger = await newUser();

    await expect(stats(stranger, { estate: "vps-ovh" })).rejects.toThrow(
      "You own no estate named vps-ovh",
    );
  });
});
