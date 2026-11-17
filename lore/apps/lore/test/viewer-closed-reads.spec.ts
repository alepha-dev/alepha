import {
  LoreActivityPermissions,
  LoreAudits,
  LoreViewerAllowlist,
  ProjectController,
  ProjectJoinController,
} from "@lore/core/api";
import { CapabilityRegistry, DashboardMetricCatalog } from "@lore/core/schemas";
import { CoreTestEntities } from "@lore/core/testing";
import { FeedbackController } from "@lore/plan/api";
import { quests } from "@lore/plan/schemas";
import { AppController, CommitQuestSetService } from "@lore/ship/api";
import { deployments } from "@lore/ship/schemas";
import { Alepha } from "alepha";
import { ApiKeyController } from "alepha/api/keys";
import { AlephaApiUsers, UserService } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { AlephaMcp } from "alepha/mcp";
import { $repository, AlephaOrm } from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer, NodeHttpServerProvider } from "alepha/server";
import { afterAll, beforeAll, describe, it } from "vitest";

import { bootLore } from "./fixtures/bootLore.ts";

/**
 * What a stranger who joined an open project by themselves reads beyond the
 * Viewer allowlist (#Q3794): nothing. Each surface here once answered from
 * membership alone, or from `project:read`, the floor every rank holds.
 *
 * Every read is made over HTTP with the stranger's own API key, as they
 * would make it, and repeated as the owner to prove the surface still
 * answers someone whose rank reads it.
 */

/**
 * The rows the live-quest case writes by hand (#E154): a deployment and the
 * quest's recorded commit.
 */
class LiveRows {
  public readonly deployments = $repository(deployments);
  public readonly quests = $repository(quests);
}

const FEEDBACK = "Checkout crashes on pay";
const APP = "storefront";

const setup = async () => {
  const alepha = Alepha.create({
    env: {
      LOG_LEVEL: "error",
      SERVER_PORT: 0,
      DATABASE_URL: ":memory:",
      LORE_OPEN_PROJECTS: "true",
    },
  });
  alepha.with(AlephaOrm);
  alepha.with(AlephaServer);
  alepha.with(AlephaSecurity);
  alepha.with(AlephaEmail);
  alepha.with(AlephaApiUsers);
  alepha.with(AlephaMcp);
  bootLore(alepha, ["api", "mcp"]);
  const repos = alepha.inject(CoreTestEntities);
  alepha.with(LiveRows);
  await alepha.start();

  const baseUrl = alepha.inject(NodeHttpServerProvider).hostname;
  const users = alepha.inject(UserService);
  const projects = alepha.inject(ProjectController);
  const keys = alepha.inject(ApiKeyController);

  const as = (id: string) =>
    ({ user: { id, roles: ["user"], realm: "users" } }) as never;
  const person = async (name: string) =>
    (await users.createUser({ username: name, email: `${name}@example.com` }))
      .id;
  const tokenOf = async (id: string) =>
    (await keys.createApiKey.fetch({ body: { name: "spec" } }, as(id))).data
      .token;

  const owner = await person("owner");
  const stranger = await person("stranger");

  const projectId = (
    await projects.createProject.fetch(
      {
        body: {
          title: "Open",
          capabilities: alepha
            .inject(CapabilityRegistry)
            .all()
            .map((it) =>
              it.key === "plan"
                ? {
                    key: it.key,
                    options: { feedback: true, epics: true, releases: true },
                  }
                : it.key === "ship"
                  ? { key: it.key, options: { track: true } }
                  : { key: it.key },
            ),
        } as never,
      },
      as(owner),
    )
  ).data.id;
  await projects.updateProjectById.fetch(
    { params: { id: projectId }, body: { joinPolicy: "open" } as never },
    as(owner),
  );

  const ownerToken = await tokenOf(owner);
  const strangerToken = await tokenOf(stranger);

  const http = async (token: string, method: string, path: string) => {
    const response = await fetch(`${baseUrl}/api${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(method === "GET" ? {} : { "Content-Type": "application/json" }),
      },
      ...(method === "GET" ? {} : { body: "{}" }),
    });
    return { status: response.status, text: await response.text() };
  };

  const mcp = async (
    token: string,
    name: string,
    args: Record<string, unknown>,
  ) => {
    const response = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name, arguments: args },
      }),
    });
    const data = (await response.json()) as {
      error?: { message: string };
      result?: { isError?: boolean; content?: Array<{ text: string }> };
    };
    if (data.error || data.result?.isError) {
      throw new Error(
        `${name}: ${data.error?.message ?? data.result?.content?.[0]?.text}`,
      );
    }
    return data.result?.content?.[0]?.text ?? "";
  };

  // The owner's project: a quest they accepted, an app with its sigil, and
  // an end-user report.
  await mcp(ownerToken, "quest_create", {
    project: projectId,
    title: "Ship the cart",
    description: "The cart",
    area: "core",
    priority: "medium",
    accept: true,
  });
  await mcp(ownerToken, "app_instance_create", {
    project: projectId,
    app: APP,
    env: "production",
  });
  await mcp(ownerToken, "sigil_create", {
    project: projectId,
    name: "storefront-key",
    app: APP,
    env: "production",
  });
  await alepha.inject(FeedbackController).submitFeedback.fetch(
    {
      params: { projectId },
      body: { title: FEEDBACK, description: "It fails" },
    },
    as(owner),
  );

  await alepha
    .inject(ProjectJoinController)
    .joinProject.fetch({ params: { id: projectId } }, as(stranger));

  // The quest is done and live on the app's copy (#E154): its commit is in
  // the set of the commit the copy's newest succeeded run shipped.
  const live = alepha.inject(LiveRows);
  const [quest] = await live.quests.findMany({
    where: { projectId: { eq: projectId } },
  });
  const commit = "c".repeat(40);
  await live.quests.updateById(quest!.id, {
    completedAt: "2026-11-01T00:00:00.000Z",
    commits: [{ sha: commit, at: "2026-11-01T00:00:00.000Z", by: owner }],
  } as never);
  const { items } = (
    await alepha
      .inject(AppController)
      .listApps.fetch({ params: { projectId } }, as(owner))
  ).data;
  await live.deployments.create({
    projectId,
    instanceId: items[0]!.id,
    app: APP,
    tag: "latest",
    sha256: "e".repeat(64),
    status: "succeeded",
    commitSha: commit,
    finishedAt: "2026-11-02T00:00:00.000Z",
  } as never);
  await alepha.inject(CommitQuestSetService).record({
    projectId,
    commitSha: commit,
    numbers: [quest!.shortId],
    walked: [],
    complete: true,
  });

  return {
    alepha,
    repos,
    projectId,
    ownerToken,
    strangerToken,
    http,
    mcp,
  };
};

type Ctx = Awaited<ReturnType<typeof setup>>;

describe("a stranger who joined an open project", () => {
  let ctx: Ctx;

  beforeAll(async () => {
    ctx = await setup();
  });

  afterAll(async () => {
    await ctx.alepha.stop();
  });

  describe("the member rows", () => {
    it("are refused without member:read, and still answer the owner", async ({
      expect,
    }) => {
      const path = `/getProjectMembers/${ctx.projectId}`;

      const refused = await ctx.http(ctx.strangerToken, "GET", path);
      expect(refused.status).toBe(403);
      expect(refused.text).not.toContain("@example.com");

      const read = await ctx.http(ctx.ownerToken, "GET", path);
      expect(read.status).toBe(200);
      expect(read.text).toContain("owner@example.com");
    });
  });

  describe("live quests (#E154)", () => {
    it("name no app to a reader without app:read, on the list or quest_get", async ({
      expect,
    }) => {
      const path = `/getQuests/${ctx.projectId}?withLive=true&status=completed`;

      const seen = await ctx.http(ctx.strangerToken, "GET", path);
      expect(seen.status).toBe(200);
      expect(seen.text).toContain("Ship the cart");
      expect(seen.text).not.toContain(APP);
      const got = await ctx.mcp(ctx.strangerToken, "quest_get", {
        project: ctx.projectId,
        shortId: 1,
      });
      expect(got).not.toContain(APP);

      const owned = await ctx.http(ctx.ownerToken, "GET", path);
      expect(owned.text).toContain(APP);
      expect(
        await ctx.mcp(ctx.ownerToken, "quest_get", {
          project: ctx.projectId,
          shortId: 1,
        }),
      ).toContain(APP);
    });
  });

  describe("the quest export", () => {
    it("names people by username, and by email only for member:read", async ({
      expect,
    }) => {
      const path = `/projects/${ctx.projectId}/quests/export`;

      const seen = await ctx.http(ctx.strangerToken, "GET", path);
      expect(seen.status).toBe(200);
      expect(seen.text).toContain("Ship the cart");
      expect(seen.text).toContain('"owner"');
      expect(seen.text).not.toContain("@example.com");

      const full = await ctx.http(ctx.ownerToken, "GET", path);
      expect(full.text).toContain("owner@example.com");
    });
  });

  describe("the activity feed", () => {
    const readable = new Set(
      LoreViewerAllowlist.READ_GROUPS.map((group) => `${group}:read`),
    );

    it("shows only the kinds the reader's rank reads, over HTTP", async ({
      expect,
    }) => {
      const seen = await ctx.http(
        ctx.strangerToken,
        "GET",
        `/projects/${ctx.projectId}/activity?size=100`,
      );
      expect(seen.status).toBe(200);
      const rows = JSON.parse(seen.text).content as Array<{ type: string }>;

      expect(rows.some((row) => row.type === "quest")).toBe(true);
      for (const row of rows) {
        expect(readable, row.type).toContain(
          LoreActivityPermissions.OF[row.type],
        );
      }
      expect(seen.text).not.toContain(FEEDBACK);
      expect(seen.text).not.toContain(APP);
    });

    it("offers only those kinds in its filters", async ({ expect }) => {
      const seen = await ctx.http(
        ctx.strangerToken,
        "GET",
        `/projects/${ctx.projectId}/activity/filters`,
      );
      const { types } = JSON.parse(seen.text) as { types: string[] };

      expect(types).toContain("quest");
      for (const type of ["feedback", "member", "app", "sigil", "host"]) {
        expect(types, type).not.toContain(type);
      }
    });

    it("shows the same through MCP's project_activity", async ({ expect }) => {
      const text = await ctx.mcp(ctx.strangerToken, "project_activity", {
        project: ctx.projectId,
        since: "2020-01-01T00:00:00.000Z",
      });

      expect(text).toContain("Ship the cart");
      expect(text).not.toContain(FEEDBACK);
      expect(text).not.toContain(APP);
    });

    it("still shows everything to the owner", async ({ expect }) => {
      const seen = await ctx.http(
        ctx.ownerToken,
        "GET",
        `/projects/${ctx.projectId}/activity?size=100`,
      );
      const types = new Set(
        (JSON.parse(seen.text).content as Array<{ type: string }>).map(
          (row) => row.type,
        ),
      );

      for (const type of ["quest", "feedback", "member", "app", "sigil"]) {
        expect(types, type).toContain(type);
      }
    });

    it("places every project-layer audit type under a permission", ({
      expect,
    }) => {
      const types = new Set(
        ctx.alepha
          .inject(LoreAudits)
          .projectLayerActions()
          .map((pair) => pair.type),
      );

      for (const type of types) {
        expect(LoreActivityPermissions.OF[type], type).toBeTypeOf("string");
      }
    });
  });

  describe("the dashboards", () => {
    it("draw the project board from what the reader's rank reads", async ({
      expect,
    }) => {
      const path = `/projects/${ctx.projectId}/dashboard`;

      const seen = await ctx.http(ctx.strangerToken, "GET", path);
      expect(seen.status).toBe(200);
      expect(seen.text).toContain("Ship the cart");
      expect(seen.text).not.toContain(FEEDBACK);
      expect(seen.text).not.toContain(APP);

      const full = await ctx.http(ctx.ownerToken, "GET", path);
      expect(full.text).toContain(FEEDBACK);
    });

    it("answer noAccess on the personal board's errors, feedback and visitors tiles", async ({
      expect,
    }) => {
      const closed = ["openErrors", "untriagedFeedback", "uniqueVisitors"];
      const tiles = async (token: string) => {
        const cards = JSON.parse(
          (await ctx.http(token, "GET", "/me/dashboard/cards")).text,
        ).cards as Array<{ id: number; metric: string }>;
        const values = JSON.parse(
          (await ctx.http(token, "POST", "/me/dashboard/resolve")).text,
        ).values as Array<{ cardId: number; empty?: string; value?: number }>;
        return closed.map((metric) => ({
          metric,
          ...values.find(
            (value) =>
              value.cardId === cards.find((card) => card.metric === metric)?.id,
          ),
        }));
      };

      for (const tile of await tiles(ctx.strangerToken)) {
        expect(tile.empty, tile.metric).toBe("noAccess");
        expect(tile.value, tile.metric).toBeUndefined();
      }

      const mine = await tiles(ctx.ownerToken);
      expect(
        mine.find((tile) => tile.metric === "untriagedFeedback")?.value,
      ).toBe(1);
      for (const tile of mine) {
        expect(tile.empty, tile.metric).not.toBe("noAccess");
      }
    });

    it("count no feedback and no error on Home", async ({ expect }) => {
      const countsOf = async (token: string) =>
        (
          JSON.parse((await ctx.http(token, "GET", "/getHomeBoard")).text)
            .openCounts as Array<{
            projectId: number;
            projectErrors: number;
            feedback: number;
          }>
        ).find((row) => row.projectId === ctx.projectId);

      expect(await countsOf(ctx.strangerToken)).toMatchObject({
        feedback: 0,
        projectErrors: 0,
      });
      expect(await countsOf(ctx.ownerToken)).toMatchObject({ feedback: 1 });
    });

    it("gives every metric but a note the permission its reader needs", ({
      expect,
    }) => {
      for (const metric of ctx.alepha.inject(DashboardMetricCatalog).all()) {
        if (metric.key === "note") continue;
        expect(metric.requires, metric.key).toBeTypeOf("string");
      }
    });
  });
});
