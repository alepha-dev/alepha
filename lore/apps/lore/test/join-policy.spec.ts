import {
  LoreViewerAllowlist,
  ProjectController,
  ProjectSecurityService,
} from "@lore/core/api";
import { CoreTestEntities } from "@lore/core/testing";
import { Alepha } from "alepha";
import { AuditService } from "alepha/api/audits";
import { ApiKeyController } from "alepha/api/keys";
import { OrganizationRankController } from "alepha/api/organizations";
import { AlephaApiUsers, UserService } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { AlephaMcp } from "alepha/mcp";
import { AlephaOrm } from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer, NodeHttpServerProvider } from "alepha/server";
import { afterEach, describe, it } from "vitest";

import { bootLore } from "./fixtures/bootLore.ts";

/**
 * A project's join policy, and the rules that keep its Viewer rank safe
 * while it is open (#Q3644, folio "Open projects: safety contract").
 *
 * Every write goes over HTTP as the browser's does.
 */

const setup = async (options: { launched?: boolean } = {}) => {
  const alepha = Alepha.create({
    env: {
      LOG_LEVEL: "error",
      SERVER_PORT: 0,
      DATABASE_URL: ":memory:",
      ...(options.launched ? { LORE_OPEN_PROJECTS: "true" } : {}),
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
  await alepha.start();

  const projects = alepha.inject(ProjectController);
  const rankApi = alepha.inject(OrganizationRankController);
  const users = alepha.inject(UserService);
  const as = (id: string) =>
    ({ user: { id, roles: ["user"], realm: "users" } }) as never;

  const owner = (
    await users.createUser({ username: "owner", email: "owner@example.com" })
  ).id;
  const project = (
    await projects.createProject.fetch({ body: { title: "Open" } }, as(owner))
  ).data;
  const organizationId = (await repos.projects.findById(project.id))!
    .organizationId!;

  const statusOf = async (call: Promise<unknown>) => {
    try {
      await call;
      return { status: 200, message: "" };
    } catch (error) {
      const failed = error as { status?: number; message?: string };
      return { status: failed.status ?? 0, message: failed.message ?? "" };
    }
  };

  const setPolicy = (joinPolicy: "invite" | "open") =>
    projects.updateProjectById.fetch(
      { params: { id: project.id }, body: { joinPolicy } },
      as(owner),
    );

  const saveViewer = (permissions: string[]) =>
    rankApi.saveOrganizationRank.fetch(
      {
        params: { organizationId, key: "viewer" },
        body: { name: "Viewer", permissions },
      },
      as(owner),
    );

  return {
    alepha,
    repos,
    projects,
    rankApi,
    as,
    owner,
    project,
    organizationId,
    statusOf,
    setPolicy,
    saveViewer,
  };
};

type Ctx = Awaited<ReturnType<typeof setup>>;

describe("a project's join policy", () => {
  let ctx: Ctx;

  afterEach(async () => {
    await ctx.alepha.stop();
  });

  it("reads as invite when the column is empty", async ({ expect }) => {
    ctx = await setup();

    const row = (await ctx.repos.projects.findById(ctx.project.id))!;
    expect(row.joinPolicy).toBeUndefined();
    expect(ctx.alepha.inject(ProjectSecurityService).joinPolicyOf(row)).toBe(
      "invite",
    );
  });

  it("refuses open for every project while the launch gate is off", async ({
    expect,
  }) => {
    ctx = await setup();

    const refused = await ctx.statusOf(ctx.setPolicy("open"));

    expect(refused.status).toBe(400);
    expect(refused.message).toContain("not available yet");
    // Setting the default it already has is no change, and is not refused.
    expect((await ctx.statusOf(ctx.setPolicy("invite"))).status).toBe(200);
  });

  describe("with the launch gate on", () => {
    it("opens a project whose Viewer fits, and audits it", async ({
      expect,
    }) => {
      ctx = await setup({ launched: true });

      const opened = await ctx.setPolicy("open");

      expect(opened.data.joinPolicy).toBe("open");
      const page = await ctx.alepha.inject(AuditService).find({
        scopeType: "project",
        scopeId: String(ctx.project.id),
        type: "project",
      });
      expect(
        page.content.some(
          (row) =>
            row.action === "update" &&
            (row.metadata as { joinPolicy?: string })?.joinPolicy === "open",
        ),
      ).toBe(true);

      // Back to invite-only.
      expect((await ctx.setPolicy("invite")).data.joinPolicy).toBe("invite");
    });

    it("refuses opening a project whose Viewer holds more than the allowlist, naming the extras", async ({
      expect,
    }) => {
      ctx = await setup({ launched: true });
      await ctx.saveViewer([
        ...LoreViewerAllowlist.PERMISSIONS,
        "automation:read",
      ]);

      const refused = await ctx.statusOf(ctx.setPolicy("open"));

      expect(refused.status).toBe(400);
      expect(refused.message).toContain('"Viewer"');
      expect(refused.message).toContain("automation:read");
    });

    it("refuses opening a project with no Viewer rank", async ({ expect }) => {
      ctx = await setup({ launched: true });
      await ctx.rankApi.deleteOrganizationRank.fetch(
        { params: { organizationId: ctx.organizationId, key: "viewer" } },
        ctx.as(ctx.owner),
      );

      const refused = await ctx.statusOf(ctx.setPolicy("open"));

      expect(refused.status).toBe(400);
      expect(refused.message).toContain("no Viewer rank");
    });

    it("refuses widening or deleting Viewer while open, and allows it once invite-only again", async ({
      expect,
    }) => {
      ctx = await setup({ launched: true });
      await ctx.setPolicy("open");

      const widened = await ctx.statusOf(
        ctx.saveViewer([...LoreViewerAllowlist.PERMISSIONS, "quest:update"]),
      );
      expect(widened.status).toBe(400);
      expect(widened.message).toContain("quest:update");

      const deleted = await ctx.statusOf(
        ctx.rankApi.deleteOrganizationRank.fetch(
          { params: { organizationId: ctx.organizationId, key: "viewer" } },
          ctx.as(ctx.owner),
        ),
      );
      expect(deleted.status).toBe(400);
      expect(deleted.message).toContain("cannot be deleted");

      // Narrowing stays allowed, and so does any other rank.
      expect(
        (await ctx.statusOf(ctx.saveViewer(["project:read", "quest:read"])))
          .status,
      ).toBe(200);
      expect(
        (
          await ctx.statusOf(
            ctx.rankApi.saveOrganizationRank.fetch(
              {
                params: { organizationId: ctx.organizationId, key: "admin" },
                body: {
                  name: "Admin",
                  permissions: ["project:read", "quest:read", "quest:update"],
                },
              },
              ctx.as(ctx.owner),
            ),
          )
        ).status,
      ).toBe(200);

      await ctx.setPolicy("invite");
      expect(
        (
          await ctx.statusOf(
            ctx.saveViewer([
              ...LoreViewerAllowlist.PERMISSIONS,
              "quest:update",
            ]),
          )
        ).status,
      ).toBe(200);
    });

    it("tells an agent the policy in project_info", async ({ expect }) => {
      ctx = await setup({ launched: true });
      await ctx.setPolicy("open");
      const token = (
        await ctx.alepha
          .inject(ApiKeyController)
          .createApiKey.fetch({ body: { name: "spec" } }, ctx.as(ctx.owner))
      ).data.token;

      const response = await fetch(
        `${ctx.alepha.inject(NodeHttpServerProvider).hostname}/mcp`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "tools/call",
            params: {
              name: "project_info",
              arguments: { project: ctx.project.id },
            },
          }),
        },
      );
      const data = (await response.json()) as {
        result: { content: Array<{ text: string }> };
      };

      expect(JSON.parse(data.result.content[0].text).joinPolicy).toBe("open");
    });
  });
});
