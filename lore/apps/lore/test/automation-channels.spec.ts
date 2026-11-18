import { DiscordTransport, MemoryDiscordTransport } from "@alepha/discord";
import {
  ProjectChannelController,
  ProjectChannelService,
  AutomationChannels,
  AutomationPersistence,
  AutomationService,
} from "@lore/core/api";
import { automationLine, createPresetRanks } from "@lore/core/testing";
import { Alepha } from "alepha";
import { JobQueueProvider } from "alepha/api/jobs";
import {
  LogDestinationProvider,
  MemoryDestinationProvider,
} from "alepha/logger";
import { CronProvider } from "alepha/scheduler";
import type { UserAccountToken } from "alepha/security";
import { afterEach, beforeEach, describe, it } from "vitest";

import { bootLore } from "./fixtures/bootLore.ts";
import {
  createTestMember,
  createTestProject,
  TestEntityRepositories,
} from "./fixtures/entities.ts";
import { ManualCronProvider } from "./fixtures/ManualCronProvider.ts";

class ChannelQueue extends JobQueueProvider {
  public override async dispatch() {}
}

const ALERTS = "https://discord.com/api/webhooks/1234567890/abcDEF-ghi_JKL";
const OTHER = "https://discord.com/api/webhooks/9876543210/zyxWVU-tsr_QPO";

/**
 * Settings > Automations > Channels (#Q3614): Discord channels, many per
 * project, each a name and a sealed webhook URL that is proven by a test
 * post and never read back.
 */
describe("Automation channels (#Q3614)", () => {
  let alepha: Alepha;
  let api: ProjectChannelController;
  let persistence: AutomationPersistence;
  let entities: TestEntityRepositories;
  let discord: MemoryDiscordTransport;
  let project: Awaited<ReturnType<typeof createTestProject>>;
  let user: UserAccountToken;
  const params = () => ({ projectId: project.id });
  const add = (name: string, url = ALERTS) =>
    api.createProjectChannel.fetch(
      { params: params(), body: { name, url } },
      { user },
    );

  beforeEach(async () => {
    alepha = Alepha.create({
      env: {
        DATABASE_URL: ":memory:",
        SERVER_PORT: 0,
        LOG_LEVEL: "trace",
        APP_SECRET: "a-spec-secret-that-is-not-the-default-one",
      },
    })
      .with({ provide: CronProvider, use: ManualCronProvider })
      .with({ provide: JobQueueProvider, use: ChannelQueue })
      .with({ provide: DiscordTransport, use: MemoryDiscordTransport })
      .with({
        provide: LogDestinationProvider,
        use: MemoryDestinationProvider,
      });
    bootLore(alepha);
    api = alepha.inject(ProjectChannelController);
    persistence = alepha.inject(AutomationPersistence);
    entities = alepha.inject(TestEntityRepositories);
    discord = alepha.inject(MemoryDiscordTransport);
    await alepha.start();
    project = await createTestProject(alepha, {
      capabilities: [{ key: "plan", options: { releases: true } }],
    });
    await entities.users.updateById(project.createdBy, { roles: ["user"] });
    user = { id: project.createdBy, roles: ["user"] };
    await createPresetRanks(alepha, project.id);
  });
  afterEach(async () => {
    await alepha.stop();
  });

  it("lists In-app and Email, then every Discord channel added, after a test post each", async ({
    expect,
  }) => {
    const alerts = (await add("alerts")).data;
    const releases = (await add("releases", OTHER)).data;
    expect(alerts).toEqual({
      id: alerts.id,
      kind: "discord",
      name: "alerts",
      builtIn: false,
    });
    expect(alerts.id).toMatch(/^discord-/);
    expect(alerts.id.length).toBeLessThanOrEqual(64);
    expect(discord.posts.map((post) => post.webhook)).toEqual([ALERTS, OTHER]);
    const listed = (
      await api.listProjectChannels.fetch({ params: params() }, { user })
    ).data.items;
    expect(listed.map((channel) => channel.name)).toEqual([
      "In-app",
      "Email",
      "alerts",
      "releases",
    ]);
    // Offered to rules once a Discord adapter is registered (#Q3615); the
    // instance is there already.
    expect(
      (await alepha.inject(AutomationChannels).instances(project.id)).map(
        (instance) => instance.id,
      ),
    ).toEqual(["inbox", "email", alerts.id, releases.id]);
  });

  it("refuses a URL that is not a Discord webhook, or that the test post fails", async ({
    expect,
  }) => {
    await expect(add("alerts", "https://example.com/hook")).rejects.toThrow(
      "expected https://discord.com/api/webhooks",
    );
    discord.failWith = "Discord refused";
    await expect(add("alerts")).rejects.toThrow("refused the test message");
    expect(await persistence.channels.count({ projectId: project.id })).toBe(0);
  });

  it("renames, replaces the URL after a test post, and refuses a duplicate name", async ({
    expect,
  }) => {
    const alerts = (await add("alerts")).data;
    await add("releases", OTHER);
    await expect(
      api.updateProjectChannel.fetch(
        { params: { ...params(), id: alerts.id }, body: { name: "releases" } },
        { user },
      ),
    ).rejects.toThrow("already exists");
    const renamed = (
      await api.updateProjectChannel.fetch(
        {
          params: { ...params(), id: alerts.id },
          body: { name: "ops", url: OTHER },
        },
        { user },
      )
    ).data;
    expect(renamed.name).toBe("ops");
    expect(discord.posts).toHaveLength(3);
  });

  it("needs automation:manage to add, rename or delete", async ({ expect }) => {
    const member = await entities.users.create({ roles: ["user"] });
    await createTestMember(alepha, project, member.id, { rank: "member" });
    const as = { id: member.id, roles: ["user"] };
    await expect(
      api.createProjectChannel.fetch(
        { params: params(), body: { name: "alerts", url: ALERTS } },
        { user: as },
      ),
    ).rejects.toThrow();
  });

  it("never puts the URL in a response, a row in the clear, or a log line", async ({
    expect,
  }) => {
    // Through the service, not over HTTP: the spec's own HTTP client logs
    // the request body it sends at trace level, which a browser does not.
    const service = alepha.inject(ProjectChannelService);
    const logs = alepha.inject(MemoryDestinationProvider);
    logs.clear();
    const created = await service.add(project.id, user, {
      name: "alerts",
      url: ALERTS,
    });
    expect(JSON.stringify(created)).not.toContain("webhooks");
    const row = await persistence.channels.getById(created.id);
    expect(row.url).not.toContain("discord.com");
    const listed = await service.list(project.id, user);
    expect(JSON.stringify(listed)).not.toContain("webhooks");
    await service.update(project.id, user, created.id, { url: OTHER });
    await service.remove(project.id, user, created.id);
    // Every line at trace level, the test posts included.
    expect(logs.logs.length).toBeGreaterThan(0);
    expect(JSON.stringify(logs.logs)).not.toContain("webhooks/1234567890");
    expect(JSON.stringify(logs.logs)).not.toContain("webhooks/9876543210");
  });

  it("removes a deleted channel from the rules that named it, unpaused", async ({
    expect,
  }) => {
    const alerts = (await add("alerts")).data;
    const rule = await alepha
      .inject(AutomationService)
      .create(project.id, user, {
        title: "Releases",
        enabled: true,
        rule: automationLine({
          trigger: { kind: "event", event: "release.published" },
          select: null,
          guard: null,
          actions: [
            {
              kind: "notify",
              recipient: user.id,
              channels: ["inbox"],
              category: "releases",
              title: "t",
              text: "t",
            },
          ],
        }),
      });
    // Named directly: the Discord adapter (#Q3615) is what would offer it.
    const graph = (await persistence.rules.getById(rule.id)).rule;
    await persistence.rules.updateById(rule.id, {
      rule: {
        ...graph,
        nodes: graph.nodes.map((node) =>
          node.id === "action-1"
            ? {
                ...node,
                config: { ...node.config, channels: ["inbox", alerts.id] },
              }
            : node,
        ),
      },
    });
    await api.deleteProjectChannel.fetch(
      { params: { ...params(), id: alerts.id } },
      { user },
    );
    const stored = await persistence.rules.getById(rule.id);
    expect(
      stored.rule.nodes.find((node) => node.id === "action-1"),
    ).toMatchObject({ type: "notify", config: { channels: ["inbox"] } });
    expect(stored).toMatchObject({ enabled: true, health: "active" });
    expect(await persistence.channels.count({ projectId: project.id })).toBe(0);
  });
});
