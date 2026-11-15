import { LoreViewerAllowlist, ProjectController } from "@lore/core/api";
import { CapabilityRegistry } from "@lore/core/schemas";
import { CoreTestEntities } from "@lore/core/testing";
import { FeedbackController } from "@lore/plan/api";
import { Alepha } from "alepha";
import { ApiKeyController } from "alepha/api/keys";
import { OrganizationRankController } from "alepha/api/organizations";
import { AlephaApiUsers, UserService } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { AlephaMcp } from "alepha/mcp";
import { AlephaOrm } from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer, NodeHttpServerProvider } from "alepha/server";
import { afterEach, beforeEach, describe, it } from "vitest";

import { bootLore } from "./fixtures/bootLore.ts";

/**
 * What a rank holding the Viewer allowlist reads, and what it is refused:
 * the leaks the safety contract of open projects lists, each checked over
 * HTTP with a real token and through the matching MCP tool with an API key.
 *
 * In an open project anyone signed in becomes a viewer, so every assertion
 * here is about a stranger.
 */

const setup = async () => {
  const alepha = Alepha.create({
    env: { LOG_LEVEL: "error", SERVER_PORT: 0, DATABASE_URL: ":memory:" },
  });
  alepha.with(AlephaOrm);
  alepha.with(AlephaServer);
  alepha.with(AlephaSecurity);
  alepha.with(AlephaEmail);
  alepha.with(AlephaApiUsers);
  alepha.with(AlephaMcp);
  bootLore(alepha, ["api", "mcp"]);
  const repos = alepha.inject(CoreTestEntities);
  await alepha.start();

  const baseUrl = alepha.inject(NodeHttpServerProvider).hostname;
  const users = alepha.inject(UserService);
  const projects = alepha.inject(ProjectController);
  const feedback = alepha.inject(FeedbackController);
  const rankApi = alepha.inject(OrganizationRankController);
  const keys = alepha.inject(ApiKeyController);
  const capabilities = alepha.inject(CapabilityRegistry);

  const as = (id: string) =>
    ({ user: { id, roles: ["user"], realm: "users" } }) as never;

  const person = async (name: string) =>
    (await users.createUser({ username: name, email: `${name}@example.com` }))
      .id;

  const owner = await person("owner");
  const created = await projects.createProject.fetch(
    {
      body: {
        title: "Open",
        capabilities: capabilities
          .all()
          .map((it) =>
            it.key === "plan"
              ? { key: it.key, options: { feedback: true } }
              : { key: it.key },
          ),
      } as never,
    },
    as(owner),
  );
  const projectId = created.data.id;
  const organizationId = (await repos.projects.findById(projectId))!
    .organizationId!;

  const RANKS: Record<string, string[]> = {
    peek: [...LoreViewerAllowlist.PERMISSIONS],
    // The allowlist plus the feedback text: still no attachment.
    reader: [...LoreViewerAllowlist.PERMISSIONS, "feedback:read"],
  };
  for (const [key, permissions] of Object.entries(RANKS)) {
    await rankApi.saveOrganizationRank.fetch(
      { params: { organizationId, key }, body: { name: key, permissions } },
      as(owner),
    );
  }

  const seat = async (name: string, rank: string) => {
    const id = await person(name);
    await repos.members.create({ organizationId, userId: id });
    await rankApi.assignOrganizationRank.fetch(
      { params: { organizationId, userId: id }, body: { key: rank } },
      as(owner),
    );
    return id;
  };

  const statusOf = async (call: Promise<unknown>) => {
    try {
      await call;
      return 200;
    } catch (error) {
      return (error as { status?: number }).status ?? 0;
    }
  };

  const tokenOf = async (id: string) =>
    (
      await keys.createApiKey.fetch({ body: { name: "spec" } }, {
        user: { id, roles: ["user"], realm: "users" },
      } as never)
    ).data.token;

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
    return {
      refused: !!data.error || data.result?.isError === true,
      text: data.error?.message ?? data.result?.content?.[0]?.text ?? "",
    };
  };

  /**
   * A project-layer write by the owner, so the feed has a row.
   */
  const describe = (description: string) =>
    projects.updateProjectById.fetch(
      { params: { id: projectId }, body: { description } as never },
      as(owner),
    );

  return {
    alepha,
    describe,
    projects,
    feedback,
    as,
    seat,
    statusOf,
    tokenOf,
    mcp,
    owner,
    projectId,
  };
};

type Ctx = Awaited<ReturnType<typeof setup>>;

describe("a rank holding the Viewer allowlist", () => {
  let ctx: Ctx;

  beforeEach(async () => {
    ctx = await setup();
  });

  afterEach(async () => {
    await ctx.alepha.stop();
  });

  describe("the member list", () => {
    it("is a public card over HTTP: name and avatar, no email", async ({
      expect,
    }) => {
      const viewer = await ctx.seat("viewer", "peek");

      const seen = (
        await ctx.projects.getProjectUsers.fetch(
          { params: { id: ctx.projectId } },
          ctx.as(viewer),
        )
      ).data;

      expect(
        seen.map((it) => it.username ?? "").sort((a, b) => a.localeCompare(b)),
      ).toEqual(["owner", "viewer"]);
      expect(seen.every((it) => it.email === undefined)).toBe(true);
      expect(JSON.stringify(seen)).not.toContain("@example.com");
    });

    it("still carries emails for a caller holding member:read", async ({
      expect,
    }) => {
      await ctx.seat("viewer", "peek");

      const seen = (
        await ctx.projects.getProjectUsers.fetch(
          { params: { id: ctx.projectId } },
          ctx.as(ctx.owner),
        )
      ).data;

      expect(
        seen.map((it) => it.email ?? "").sort((a, b) => a.localeCompare(b)),
      ).toEqual(["owner@example.com", "viewer@example.com"]);
    });

    it("leaks no email through MCP's project reads", async ({ expect }) => {
      const viewer = await ctx.seat("viewer", "peek");
      const token = await ctx.tokenOf(viewer);

      for (const tool of ["project_info", "project_context"]) {
        const result = await ctx.mcp(token, tool, { project: ctx.projectId });
        expect(result.refused, tool).toBe(false);
        expect(result.text, tool).not.toContain("@example.com");
      }
    });
  });

  describe("the activity feed", () => {
    it("carries no audit metadata over HTTP, where a member:read holder gets it", async ({
      expect,
    }) => {
      const viewer = await ctx.seat("viewer", "peek");
      // A project-layer write, whose audit row carries metadata.
      await ctx.describe("the open one");

      const read = async (userId: string) =>
        (
          await ctx.projects.getProjectActivity.fetch(
            { params: { id: ctx.projectId }, query: {} },
            ctx.as(userId),
          )
        ).data.content;

      const owners = await read(ctx.owner);
      const viewers = await read(viewer);

      expect(viewers.length).toBe(owners.length);
      expect(owners.some((row) => row.metadata !== undefined)).toBe(true);
      expect(viewers.every((row) => row.metadata === undefined)).toBe(true);
      expect(JSON.stringify(viewers)).not.toContain("@example.com");
    });

    it("leaks no email through MCP's project_activity", async ({ expect }) => {
      const viewer = await ctx.seat("viewer", "peek");
      const token = await ctx.tokenOf(viewer);
      await ctx.describe("the open one");

      const result = await ctx.mcp(token, "project_activity", {
        project: ctx.projectId,
        since: "2000-01-01T00:00:00.000Z",
        includeOwn: true,
      });

      expect(result.refused).toBe(false);
      expect(JSON.parse(result.text).events.length).toBeGreaterThan(0);
      expect(result.text).not.toContain("@example.com");
    });
  });

  describe("a feedback attachment", () => {
    it("is refused over HTTP to feedback:read alone, before the row is looked up", async ({
      expect,
    }) => {
      const reader = await ctx.seat("reader", "reader");
      const params = {
        projectId: ctx.projectId,
        feedbackId: 1,
        attachmentId: crypto.randomUUID(),
      };

      expect(
        await ctx.statusOf(
          ctx.feedback.getFeedbackAttachment.fetch({ params }, ctx.as(reader)),
        ),
      ).toBe(403);
      // The owner passes the gate and meets the missing row.
      expect(
        await ctx.statusOf(
          ctx.feedback.getFeedbackAttachment.fetch(
            { params },
            ctx.as(ctx.owner),
          ),
        ),
      ).toBe(404);
    });

    it("is refused through MCP's feedback_attachment_get, to feedback:read and to the allowlist", async ({
      expect,
    }) => {
      await ctx.feedback.submitFeedback.fetch(
        {
          params: { projectId: ctx.projectId },
          body: { title: "A report", description: "With a screenshot" },
        },
        ctx.as(ctx.owner),
      );
      for (const rank of ["reader", "peek"]) {
        const token = await ctx.tokenOf(await ctx.seat(`as-${rank}`, rank));
        const result = await ctx.mcp(token, "feedback_attachment_get", {
          project: ctx.projectId,
          shortId: 1,
          attachmentId: crypto.randomUUID(),
        });
        expect(result.refused, rank).toBe(true);
        expect(result.text, rank).toMatch(
          rank === "reader" ? /feedback:triage/ : /feedback:(read|triage)/,
        );
      }
    });
  });

  describe("what the allowlist leaves out", () => {
    it("refuses automations, errors and apps through MCP", async ({
      expect,
    }) => {
      const viewer = await ctx.seat("viewer", "peek");
      const token = await ctx.tokenOf(viewer);

      for (const tool of [
        "automation_list",
        "error_list",
        "app_instance_list",
      ]) {
        const result = await ctx.mcp(token, tool, { project: ctx.projectId });
        expect(result.refused, tool).toBe(true);
        expect(result.text, tool).toMatch(/:read/);
      }
    });
  });
});
