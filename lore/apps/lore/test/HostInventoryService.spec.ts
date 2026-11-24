import {
  AgentHostService,
  HostInventoryService,
  HostController,
} from "@lore/core/api";
import {
  hostInventories,
  type Host,
  hosts,
  type HostInventoryFrame,
} from "@lore/core/schemas";
import { createTestProject } from "@lore/core/testing";
import { createTestHost } from "@lore/core/testing/hosts";
import { LoreShipApi } from "@lore/ship/api";
import { appInstances } from "@lore/ship/schemas";
import { DeployTestEntities } from "@lore/ship/testing";
import { Alepha } from "alepha";
import { AlephaApiUsers } from "alepha/api/users";
import { DateTimeProvider } from "alepha/datetime";
import { AlephaEmail } from "alepha/email";
import { $repository, AlephaOrm } from "alepha/orm";
import type { UserAccountToken } from "alepha/security";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { afterEach, beforeEach, describe, it } from "vitest";

class InventoryRepositories {
  hosts = $repository(hosts);
  inventories = $repository(hostInventories);
  instances = $repository(appInstances);
}

interface TestContext {
  alepha: Alepha;
  service: HostInventoryService;
  hostApi: HostController;
  repos: InventoryRepositories;
  entities: DeployTestEntities;
  dateTime: DateTimeProvider;
}

const setup = async (): Promise<TestContext> => {
  const alepha = Alepha.create({
    env: { LOG_LEVEL: "error", DATABASE_URL: ":memory:" },
  });
  alepha.with(AlephaOrm);
  alepha.with(AlephaServer);
  alepha.with(AlephaSecurity);
  alepha.with(AlephaEmail);
  alepha.with(AlephaApiUsers);
  alepha.with(LoreShipApi);

  const entities = alepha.inject(DeployTestEntities);
  const repos = alepha.inject(InventoryRepositories);

  await alepha.start();

  return {
    alepha,
    service: alepha.inject(HostInventoryService),
    hostApi: alepha.inject(HostController),
    repos,
    entities,
    dateTime: alepha.inject(DateTimeProvider),
  };
};

const createHost = async (
  ctx: TestContext,
  slug: string,
): Promise<{ host: Host; user: UserAccountToken }> => {
  const created = await ctx.entities.users.create({});
  const user: UserAccountToken = { id: created.id, roles: ["user"] };
  const minted = await createTestHost(ctx.alepha, user, { slug });
  return {
    host: await ctx.repos.hosts.getOne({
      where: { id: { eq: minted.id } },
    }),
    user,
  };
};

/**
 * The machine's clock is deliberately far from Lore's, so a stamp copied
 * from the frame would be visible.
 */
const MACHINE_CLOCK = "2001-01-01T00:00:00.000Z";

const frame = (apps: string[], bayVersion = "0.31.0"): HostInventoryFrame => ({
  type: "inventory",
  at: MACHINE_CLOCK,
  host: { cores: 4, memTotalBytes: 8 * 1024 ** 3, bayVersion },
  apps: apps.map((app) => ({
    app,
    env: "production",
    running: true,
    state: "active",
    backups: false,
    problems: [],
  })),
});

describe("HostInventoryService", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setup();
  });

  afterEach(async () => {
    await ctx.alepha.stop();
  });

  /**
   * The whole storage decision in one assertion. A machine pushes on
   * connect, on its tick and after every command that changes state, so an
   * append would grow without bound for a page that only shows the latest.
   */
  it("keeps one row per host however many times a machine pushes", async ({
    expect,
  }) => {
    const { host } = await createHost(ctx, "ovh-1");

    await ctx.service.record(host, frame(["lore"]));
    await ctx.service.record(host, frame(["lore", "docs"]));
    await ctx.service.record(host, frame(["docs"]));

    const rows = await ctx.repos.inventories.findMany({
      where: { hostId: { eq: host.id } },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.apps.map((row) => row.app)).toEqual(["docs"]);
    expect(rows[0]?.appCount).toBe(1);
  });

  it("stamps reportedAt with Lore's clock and keeps the machine's as a claim", async ({
    expect,
  }) => {
    const { host } = await createHost(ctx, "ovh-2");
    ctx.dateTime.pause();

    await ctx.service.record(host, frame(["lore"]));

    const row = await ctx.service.findFor(host.id);
    expect(row?.at).toBe(MACHINE_CLOCK);
    expect(row?.reportedAt).toBe(
      new Date(ctx.dateTime.nowMillis()).toISOString(),
    );
    // A host whose clock is hours off must not make the console say
    // "reported 25 years ago" beside a connection that is up.
    expect(row?.reportedAt).not.toBe(MACHINE_CLOCK);
  });

  it("denormalises the app count and lifts the version off the host block", async ({
    expect,
  }) => {
    const { host } = await createHost(ctx, "ovh-3");

    await ctx.service.record(host, frame(["lore", "docs", "api"], "0.32.1"));

    const row = await ctx.service.findFor(host.id);
    // The count is stored so a list can say "3 apps" without deserializing
    // every host's array.
    expect(row?.appCount).toBe(3);
    expect(row?.bayVersion).toBe("0.32.1");
    expect(row?.machine.cores).toBe(4);
  });

  /**
   * Absent is a state the console renders, and it is not an empty inventory:
   * a host with no apps and a host that never spoke are two different
   * sentences.
   */
  it("keeps on the host what its jobs user has, for the Agent card and the agent gate (#Q4220)", async ({
    expect,
  }) => {
    const { host } = await createHost(ctx, "agent-1");
    const tools = [
      { name: "claude", kind: "agent", found: true, version: "2.1.7" },
      {
        name: "gemini",
        kind: "agent",
        found: false,
        error: "gemini is not on the jobs user's PATH",
      },
      { name: "git", kind: "tool", found: true, version: "2.43.0" },
    ];
    await ctx.service.record(host, {
      ...frame([]),
      jobs: { user: "bay-agent", tools },
    });
    const row = await ctx.repos.hosts.getOne({
      where: { id: { eq: host.id } },
    });
    expect(row.jobsTools).toEqual(tools);
    expect(AgentHostService.agentsOf(row.jobsTools)).toEqual(["claude"]);

    // Its sources and its slots (#E173, #Q4249): two running of three.
    const running = [
      "5a7c9e1b-3d2f-4a6b-8c1e-9f0a2b3c4d5e",
      "6b8d0f2c-4e3a-4b7c-9d2f-0a1b2c3d4e5f",
    ].join(",");
    await ctx.service.record(row, {
      ...frame([]),
      jobs: { user: "bay-agent", tools, sources: true, maxJobs: 3, running },
    });
    const slots = await ctx.repos.hosts.getOne({
      where: { id: { eq: host.id } },
    });
    expect(slots).toMatchObject({
      jobsSources: true,
      jobsMaxJobs: 3,
      jobsRunning: 2,
    });
    expect(slots.jobsResult).toBe(false);

    // A Bay whose terminal acks carry the agent's reply says so (#Q4288).
    await ctx.service.record(slots, {
      ...frame([]),
      jobs: { user: "bay-agent", tools, sources: true, result: true },
    });
    const replies = await ctx.repos.hosts.getOne({
      where: { id: { eq: host.id } },
    });
    expect(replies.jobsResult).toBe(true);
  });

  it("answers nothing for a machine that has never reported", async ({
    expect,
  }) => {
    const { host } = await createHost(ctx, "ovh-4");
    expect(await ctx.service.findFor(host.id)).toBeUndefined();
  });

  it("keeps two hosts' snapshots apart", async ({ expect }) => {
    const first = await createHost(ctx, "ovh-5");
    const second = await createHost(ctx, "ovh-6");

    await ctx.service.record(first.host, frame(["lore"]));
    await ctx.service.record(second.host, frame(["shop", "docs"]));

    expect((await ctx.service.findFor(first.host.id))?.appCount).toBe(1);
    expect((await ctx.service.findFor(second.host.id))?.appCount).toBe(2);
  });
});

/**
 * The reconciliation is the whole reason the snapshot is stored server-side,
 * so it is proven server-side: three states out of one frame, with no
 * browser involved.
 */
describe("HostInventoryService.reconcile", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setup();
  });

  afterEach(async () => {
    await ctx.alepha.stop();
  });

  it("answers matched, untracked and missing from one stored inventory", async ({
    expect,
  }) => {
    const { host } = await createHost(ctx, "ovh-7");
    const project = await createTestProject(ctx.alepha);

    // Tracked here and reported: matched. Tracked here and NOT reported:
    // missing, which is what a failed deploy looks like.
    const matched = await ctx.repos.instances.create({
      projectId: project.id,
      app: "lore",
      env: "production",
      hostId: host.id,
    });
    const missing = await ctx.repos.instances.create({
      projectId: project.id,
      app: "shop",
      env: "staging",
      hostId: host.id,
    });
    // Tracked in the project but pointing at no host: this machine's
    // report says nothing about it either way.
    await ctx.repos.instances.create({
      projectId: project.id,
      app: "elsewhere",
      env: "production",
    });

    // Reported and tracked nowhere: untracked.
    await ctx.service.record(host, frame(["lore", "stray"]));

    const result = await ctx.service.reconcile(host);
    const reported = result.inventory?.apps ?? [];
    expect(reported.map((row) => [row.app, row.tracking])).toEqual([
      ["lore", "matched"],
      ["stray", "untracked"],
    ]);
    expect(reported[0]?.instanceId).toBe(matched.id);
    expect(reported[0]?.project).toEqual({
      id: project.id,
      title: project.title,
      slug: project.slug,
    });
    // An untracked row has no instance and no project: there is nothing in
    // Lore to link it to.
    expect(reported[1]?.instanceId).toBeUndefined();
    expect(reported[1]?.project).toBeUndefined();

    expect(result.expected).toHaveLength(1);
    expect(result.expected[0]).toMatchObject({
      app: "shop",
      env: "staging",
      instanceId: missing.id,
      tracking: "missing",
    });
  });

  /**
   * A machine that never connected has no row, and that is an answer rather
   * than a 404: the page says "nothing reported yet" and still lists what
   * Lore expects to find there.
   */
  it("answers a null inventory beside the expected rows for a machine that never reported", async ({
    expect,
  }) => {
    const { host } = await createHost(ctx, "ovh-8");
    const project = await createTestProject(ctx.alepha);
    await ctx.repos.instances.create({
      projectId: project.id,
      app: "lore",
      env: "production",
      hostId: host.id,
    });

    const result = await ctx.service.reconcile(host);
    expect(result.inventory).toBeNull();
    expect(result.expected.map((row) => row.app)).toEqual(["lore"]);
  });

  /**
   * The pair is the key, so the same app name in another environment is a
   * different instance and must not match.
   */
  it("matches on the pair, never on the app name alone", async ({ expect }) => {
    const { host } = await createHost(ctx, "ovh-9");
    const project = await createTestProject(ctx.alepha);
    await ctx.repos.instances.create({
      projectId: project.id,
      app: "lore",
      env: "staging",
      hostId: host.id,
    });

    await ctx.service.record(host, frame(["lore"]));

    const result = await ctx.service.reconcile(host);
    expect(result.inventory?.apps[0]?.tracking).toBe("untracked");
    expect(result.expected.map((row) => `${row.app}/${row.env}`)).toEqual([
      "lore/staging",
    ]);
  });

  it("summarises a list of hosts in one query", async ({ expect }) => {
    const first = await createHost(ctx, "ovh-10");
    const second = await createHost(ctx, "ovh-11");
    await ctx.service.record(first.host, frame(["lore", "docs"]));

    const summaries = await ctx.service.summariesFor([
      first.host.id,
      second.host.id,
    ]);
    expect(summaries.get(first.host.id)?.appCount).toBe(2);
    // Never reported: absent rather than a zero, so the row says "not
    // reported" instead of "0 apps".
    expect(summaries.get(second.host.id)).toBeUndefined();
    expect(await ctx.service.summariesFor([])).toEqual(new Map());
  });
});
