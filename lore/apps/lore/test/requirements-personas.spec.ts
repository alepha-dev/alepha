import { ResourceLinkService } from "@lore/core/api";
import { PersonaController } from "@lore/plan-requirements/api";
import { QuestController } from "@lore/plan/api";
import { AuditService } from "alepha/api/audits";
import { afterEach, beforeEach, describe, it } from "vitest";

import {
  type RequirementsProject,
  requirementsProject,
} from "./fixtures/requirementsProject.ts";

/**
 * Personas, Plan's Requirements (#E153, #Q3764): written by every member,
 * read by the Viewer rank, gated on Plan's `requirements` option for writes,
 * and addressable as `[[#A2]]`.
 */

describe("personas", () => {
  let ctx: RequirementsProject;
  let api: PersonaController;

  beforeEach(async () => {
    ctx = await requirementsProject();
    api = ctx.alepha.inject(PersonaController);
  });

  afterEach(async () => {
    await ctx.alepha.stop();
  });

  it("are created, read, updated, commented on and deleted by a member, each write audited", async ({
    expect,
  }) => {
    const member = await ctx.seat("member");

    const lea = (
      await api.createPersona.fetch(
        {
          params: { projectId: ctx.projectId },
          body: {
            name: "Léa",
            role: "Shop manager",
            kind: "human",
            demoAccount: "lea@acme.test",
            environmentApp: "shop",
            environmentEnv: "staging",
          },
        },
        ctx.as(member),
      )
    ).data;
    const bot = (
      await api.createPersona.fetch(
        {
          params: { projectId: ctx.projectId },
          body: { name: "Indexer", kind: "system" },
        },
        ctx.as(member),
      )
    ).data;
    expect([lea.number, bot.number]).toEqual([1, 2]);

    const systems = (
      await api.getPersonas.fetch(
        { params: { projectId: ctx.projectId }, query: { kind: "system" } },
        ctx.as(member),
      )
    ).data;
    expect(systems.map((it) => it.name)).toEqual(["Indexer"]);

    await api.updatePersona.fetch(
      { params: { id: lea.id }, body: { goals: "Ship orders **fast**" } },
      ctx.as(member),
    );
    await api.addPersonaComment.fetch(
      { params: { id: lea.id }, body: { body: "Interviewed on Monday" } },
      ctx.as(member),
    );
    const read = (
      await api.getPersonaByNumber.fetch(
        { params: { projectId: ctx.projectId, number: 1 } },
        ctx.as(member),
      )
    ).data;
    expect(read.goals).toBe("Ship orders **fast**");
    expect(read.role).toBe("Shop manager");
    const comments = (
      await api.getPersonaComments.fetch(
        { params: { projectId: ctx.projectId, number: 1 } },
        ctx.as(member),
      )
    ).data;
    expect(comments.map((it) => it.body)).toEqual(["Interviewed on Monday"]);

    await api.deletePersona.fetch({ params: { id: bot.id } }, ctx.as(member));
    expect(
      await ctx.statusOf(
        api.getPersonaByNumber.fetch(
          { params: { projectId: ctx.projectId, number: 2 } },
          ctx.as(member),
        ),
      ),
    ).toBe(404);
    // The number is never reused.
    const next = (
      await api.createPersona.fetch(
        { params: { projectId: ctx.projectId }, body: { name: "Paul" } },
        ctx.as(member),
      )
    ).data;
    expect(next.number).toBe(3);

    const audits = await ctx.alepha
      .inject(AuditService)
      .find({ type: "persona" });
    const actions = audits.content.map((it) => it.action);
    expect([...new Set(actions)].sort()).toEqual([
      "comment",
      "create",
      "delete",
      "update",
    ]);
  });

  it("are read by a viewer, who writes none", async ({ expect }) => {
    const viewer = await ctx.seat("viewer", "peek");
    await api.createPersona.fetch(
      { params: { projectId: ctx.projectId }, body: { name: "Léa" } },
      ctx.as(ctx.owner),
    );

    const seen = (
      await api.getPersonas.fetch(
        { params: { projectId: ctx.projectId }, query: {} },
        ctx.as(viewer),
      )
    ).data;
    expect(seen.map((it) => it.name)).toEqual(["Léa"]);
    expect(
      await ctx.statusOf(
        api.createPersona.fetch(
          { params: { projectId: ctx.projectId }, body: { name: "Mallory" } },
          ctx.as(viewer),
        ),
      ),
    ).toBe(403);
    expect(
      await ctx.statusOf(
        api.updatePersona.fetch(
          { params: { id: seen[0].id }, body: { name: "Mallory" } },
          ctx.as(viewer),
        ),
      ),
    ).toBe(403);
  });

  it("refuse a write, and their tools, while Plan's requirements option is off, and keep reads open", async ({
    expect,
  }) => {
    const lea = (
      await api.createPersona.fetch(
        { params: { projectId: ctx.projectId }, body: { name: "Léa" } },
        ctx.as(ctx.owner),
      )
    ).data;
    await ctx.setPlan({ ...ctx.planOptions, requirements: false });

    expect(
      await ctx.statusOf(
        api.createPersona.fetch(
          { params: { projectId: ctx.projectId }, body: { name: "Paul" } },
          ctx.as(ctx.owner),
        ),
      ),
    ).toBe(400);
    expect(
      await ctx.statusOf(
        api.getPersonaByNumber.fetch(
          { params: { projectId: ctx.projectId, number: lea.number } },
          ctx.as(ctx.owner),
        ),
      ),
    ).toBe(200);

    // A read tool answers either way (disabling hides, it never deletes); a
    // write tool goes through the same refused action.
    const token = await ctx.tokenOf(ctx.owner);
    const listed = await ctx.mcp(token, "persona_list", {});
    expect(listed.refused).toBe(false);
    expect(listed.text).toContain("Léa");
    expect(
      (await ctx.mcp(token, "persona_create", { name: "Paul" })).refused,
    ).toBe(true);

    await ctx.setPlan({ ...ctx.planOptions, requirements: true });
    expect(
      (await ctx.mcp(token, "persona_create", { name: "Paul" })).refused,
    ).toBe(false);
  });

  it("write and read through their MCP tools", async ({ expect }) => {
    const token = await ctx.tokenOf(ctx.owner);

    const created = await ctx.mcp(token, "persona_create", {
      name: "Ops bot",
      kind: "agent",
      alephaRole: "service",
    });
    expect(created.refused).toBe(false);
    await ctx.mcp(token, "persona_update", { number: 1, role: "Restocks" });
    await ctx.mcp(token, "persona_comment_add", {
      number: 1,
      body: "Runs nightly",
      as: "claude-code",
    });

    const got = await ctx.mcp(token, "persona_get", { number: 1 });
    expect(got.refused).toBe(false);
    expect(got.text).toContain("Restocks");
    expect(got.text).toContain("Runs nightly");

    const gone = await ctx.mcp(token, "persona_delete", { number: 1 });
    expect(gone.refused).toBe(false);
    expect((await ctx.mcp(token, "persona_get", { number: 1 })).refused).toBe(
      true,
    );
  });

  it("are addressed as [[#A1]] from a quest body", async ({ expect }) => {
    const lea = (
      await api.createPersona.fetch(
        { params: { projectId: ctx.projectId }, body: { name: "Léa" } },
        ctx.as(ctx.owner),
      )
    ).data;

    const quest = await ctx.alepha.inject(QuestController).createQuest.fetch(
      {
        body: {
          projectId: ctx.projectId,
          title: "Checkout for Léa",
          area: "shop",
          priority: "medium",
          size: 3,
          description: "As [[#A1]], I check out.",
        } as never,
      },
      ctx.as(ctx.owner),
    );

    const rows = await ctx.alepha
      .inject(ResourceLinkService)
      .findOutbound({ kind: "quest", id: quest.data.id });
    expect(rows.map((it) => [it.targetType, it.toId])).toEqual([
      ["persona", String(lea.id)],
    ]);
  });
});
