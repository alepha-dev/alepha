import { Alepha } from "alepha";
import { AlephaApiUsers, UserService } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { AlephaFake } from "alepha/fake";
import { AlephaOrm } from "alepha/orm";
import { AlephaSecurity, currentUserAtom } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { describe, it } from "vitest";

import { FolioController } from "@/api/controllers/FolioController.ts";
import { ProjectCapabilityController } from "@/api/controllers/ProjectCapabilityController.ts";
import { ProjectController } from "@/api/controllers/ProjectController.ts";
import { QuestController } from "@/api/controllers/QuestController.ts";
import { LoreApi } from "@/api/index.ts";
import type { CapabilityKey } from "@/api/schemas/capabilityKeySchema.ts";

/**
 * The Activity feed is Core; what it SHOWS is not.
 *
 * A project that turns Work off keeps every quest it had, and every audit row
 * about them - disabling hides and never deletes. So the rows of a disabled
 * capability are filtered out of the feed rather than purged, and come back
 * untouched when the switch does. The filter is a narrowing of the `type`
 * column that `AuditService.find` already accepts as a list, so a project with
 * everything on issues exactly the query it always did.
 *
 * ⚠️ **`project:capability` is an audit event, not a derivation.** Epic #36
 * first proposed reading it off `project_capabilities.enabledAt`, which cannot
 * record a disable at all: turning a capability off DELETES the row. The
 * second case below is that half.
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
  alepha.with(AlephaFake);
  alepha.with(LoreApi);

  const projectApi = alepha.inject(ProjectController);
  const questApi = alepha.inject(QuestController);
  const folioApi = alepha.inject(FolioController);
  const capabilityApi = alepha.inject(ProjectCapabilityController);
  const users = alepha.inject(UserService);
  await alepha.start();

  const owner = await users.createUser({ username: "owner" });

  const asUser = <R>(fn: () => R): R =>
    alepha.context.run(() => {
      alepha.store.set(currentUserAtom, {
        id: owner.id,
        roles: ["user"],
      } as never);
      return fn();
    });

  return { alepha, projectApi, questApi, folioApi, capabilityApi, asUser };
};

type Ctx = Awaited<ReturnType<typeof setup>>;

const activity = (ctx: Ctx, projectId: number, type?: string) =>
  ctx.asUser(() =>
    ctx.projectApi.getProjectActivity({
      params: { id: projectId },
      query: type ? { type } : {},
    } as never),
  );

const setCapability = (
  ctx: Ctx,
  projectId: number,
  key: CapabilityKey,
  enabled: boolean,
) =>
  ctx.asUser(() =>
    ctx.capabilityApi.setCapability({
      params: { projectId, key },
      body: { enabled },
    } as never),
  );

describe("the activity feed and capabilities", () => {
  it("stops showing a capability's events once it is turned off", async ({
    expect,
  }) => {
    const ctx = await setup();
    const project = await ctx.asUser(() =>
      ctx.projectApi.createProject({
        body: {
          title: "Mixed",
          capabilities: [{ key: "work" }, { key: "knowledge" }],
        },
      }),
    );

    await ctx.asUser(() =>
      ctx.questApi.createQuest({
        body: {
          projectId: project.id,
          title: "A quest",
          description: "",
          area: "general",
          priority: "medium",
        },
      } as never),
    );
    await ctx.asUser(() =>
      ctx.folioApi.create({
        body: { projectId: project.id, title: "A folio", content: "body" },
      } as never),
    );

    const both = await activity(ctx, project.id);
    expect(both.content.some((row) => row.type === "quest")).toBe(true);
    expect(both.content.some((row) => row.type === "folio")).toBe(true);

    await setCapability(ctx, project.id, "work", false);

    const after = await activity(ctx, project.id);
    expect(after.content.some((row) => row.type === "quest")).toBe(false);
    // Knowledge's rows are untouched, and so is the Core `project` row the
    // capability change itself just wrote - the feed is not a capability.
    expect(after.content.some((row) => row.type === "folio")).toBe(true);
    expect(after.content.some((row) => row.type === "project")).toBe(true);

    // And back: nothing was purged, so the quest row returns.
    await setCapability(ctx, project.id, "work", true);
    const restored = await activity(ctx, project.id);
    expect(restored.content.some((row) => row.type === "quest")).toBe(true);

    await ctx.alepha.stop();
  });

  it("records turning a capability on and off, both halves", async ({
    expect,
  }) => {
    const ctx = await setup();
    const project = await ctx.asUser(() =>
      ctx.projectApi.createProject({
        body: { title: "Switches", capabilities: [{ key: "knowledge" }] },
      }),
    );

    await setCapability(ctx, project.id, "support", true);
    await setCapability(ctx, project.id, "support", false);

    const feed = await activity(ctx, project.id);
    const events = feed.content.filter((row) => row.action === "capability");

    // Two rows, newest first, and the OFF one exists at all - which is the
    // whole argument against deriving this from `enabledAt`, a column that
    // is deleted by the very event it would have to describe.
    expect(events).toHaveLength(2);
    expect(events[0]!.metadata).toMatchObject({
      capability: "support",
      enabled: false,
    });
    expect(events[1]!.metadata).toMatchObject({
      capability: "support",
      enabled: true,
    });

    await ctx.alepha.stop();
  });

  it("answers nothing when the caller asks only for a disabled kind", async ({
    expect,
  }) => {
    const ctx = await setup();
    const project = await ctx.asUser(() =>
      ctx.projectApi.createProject({
        body: { title: "Notes", capabilities: [{ key: "knowledge" }] },
      }),
    );
    await ctx.asUser(() =>
      ctx.folioApi.create({
        body: { projectId: project.id, title: "A folio", content: "body" },
      } as never),
    );

    // ⚠️ The intersection is the load-bearing part: an empty `type` string
    // reads as "no filter" in `AuditService`, so a naive implementation would
    // answer this with EVERY kind instead of none.
    const asked = await activity(ctx, project.id, "quest");
    expect(asked.content).toEqual([]);

    await ctx.alepha.stop();
  });

  it("offers only the enabled kinds in the filter dropdown", async ({
    expect,
  }) => {
    const ctx = await setup();
    const project = await ctx.asUser(() =>
      ctx.projectApi.createProject({
        body: { title: "Notes", capabilities: [{ key: "knowledge" }] },
      }),
    );

    const filters = await ctx.asUser(() =>
      ctx.projectApi.getProjectActivityFilters({ params: { id: project.id } }),
    );

    expect(filters.types).toContain("folio");
    expect(filters.types).not.toContain("quest");
    expect(filters.types).not.toContain("feedback");
    expect(filters.types).not.toContain("sigil");
    // `member` and `project` are Core: owned by nobody, always offered.
    expect(filters.types).toContain("member");
    expect(filters.types).toContain("project");

    await ctx.alepha.stop();
  });
});
