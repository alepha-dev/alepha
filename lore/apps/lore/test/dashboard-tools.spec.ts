import { DashboardTools } from "@lore/core/mcp";
import { createPresetRanks } from "@lore/core/testing";
import { sigils } from "@lore/ship/schemas";
import { Alepha } from "alepha";
import { $repository } from "alepha/orm";
import { currentUserAtom, type UserAccountToken } from "alepha/security";
import { afterEach, beforeEach, describe, it } from "vitest";

import { bootLore } from "./fixtures/bootLore.ts";
import {
  createTestMember,
  createTestProject,
  TestEntityRepositories,
} from "./fixtures/entities.ts";

class Rows extends TestEntityRepositories {
  sigils = $repository(sigils);
}

/**
 * The dashboard tools (#Q4206), on the actions the board's edit mode calls:
 * `project:read` reads, `project:update` writes.
 */
describe("Dashboard tools", () => {
  let alepha: Alepha;
  let rows: Rows;
  let tools: DashboardTools;
  let project: Awaited<ReturnType<typeof createTestProject>>;
  let owner: UserAccountToken;
  let member: UserAccountToken;
  const call = (user: UserAccountToken, tool: any, params: object) =>
    alepha.context.run(() => {
      alepha.store.set(currentUserAtom, user);
      return tool.execute({ project: project.id, ...params });
    }) as Promise<any>;

  beforeEach(async () => {
    alepha = Alepha.create({
      env: {
        DATABASE_URL: ":memory:",
        SERVER_PORT: 0,
        LOG_LEVEL: "silent",
        APP_SECRET: "a-spec-secret-that-is-not-the-default-one",
      },
    });
    bootLore(alepha, ["api", "mcp"]);
    rows = alepha.inject(Rows);
    tools = alepha.inject(DashboardTools);
    await alepha.start();
    project = await createTestProject(alepha, {
      capabilities: [{ key: "ship", options: { deploy: true, track: true } }],
    });
    await createPresetRanks(alepha, project.id);
    await rows.users.updateById(project.createdBy, { roles: ["user"] });
    owner = { id: project.createdBy, roles: ["user"] };
    const other = await rows.users.create({
      email: "member@example.test",
      roles: ["user"],
    });
    await createTestMember(alepha, project, other.id, { rank: "member" });
    member = { id: other.id, roles: ["user"] };
  });
  afterEach(async () => {
    await alepha.stop();
  });

  it("dashboard_metric_catalog lists the project board's metrics with their scope kinds and filters", async ({
    expect,
  }) => {
    const { metrics } = await call(member, tools.dashboard_metric_catalog, {});
    const visitors = metrics.find((it: any) => it.key === "uniqueVisitors");
    expect(visitors).toMatchObject({
      scopeKinds: ["apps", "projects"],
      needs: { capability: "ship", option: "track" },
      needsBeacon: true,
      defaultFilters: { period: "window" },
    });
    expect(visitors.filters).toMatchObject({ type: "object" });
    expect(metrics.some((it: any) => it.key === "activeQuests")).toBe(true);
  });

  it("adds an app-scoped card, updates, reorders and removes it, and lists the dashboards", async ({
    expect,
  }) => {
    const app = await rows.sigils.create({
      projectId: project.id,
      name: "docs",
      tokenHash: "hash-docs",
      tokenPrefix: "sg_d",
      kinds: ["beacon"],
    });
    const { dashboards } = await call(owner, tools.dashboard_list, {});
    expect(dashboards).toHaveLength(1);
    expect(dashboards[0]).toMatchObject({ first: true });

    const visitors = await call(owner, tools.dashboard_card_add, {
      metric: "uniqueVisitors",
      scope: { kind: "apps", sigilIds: [app.id] },
      section: "Traffic",
    });
    expect(visitors).toMatchObject({
      metric: "uniqueVisitors",
      scope: { kind: "apps", sigilIds: [app.id] },
      section: "Traffic",
    });
    const errors = await call(owner, tools.dashboard_card_add, {
      metric: "openErrors",
    });
    expect(errors.scope).toEqual({
      kind: "projects",
      projectIds: [project.id],
    });

    const wider = await call(owner, tools.dashboard_card_update, {
      card: visitors.id,
      size: 2,
    });
    expect(wider).toMatchObject({ id: visitors.id, size: 2 });

    const reordered = await call(owner, tools.dashboard_card_reorder, {
      ids: [errors.id, visitors.id],
    });
    expect(reordered.cards.map((it: any) => it.id)).toEqual([
      errors.id,
      visitors.id,
    ]);

    expect(
      await call(owner, tools.dashboard_card_remove, { card: errors.id }),
    ).toEqual({ ok: true });
    const { cards } = await call(member, tools.dashboard_card_list, {});
    expect(cards.map((it: any) => it.id)).toEqual([visitors.id]);
  });

  it("refuses an app of another project and a scope kind the metric does not accept", async ({
    expect,
  }) => {
    const elsewhere = await createTestProject(alepha);
    const theirs = await rows.sigils.create({
      projectId: elsewhere.id,
      name: "theirs",
      tokenHash: "hash-theirs",
      tokenPrefix: "sg_t",
      kinds: ["beacon"],
    });
    const ours = await rows.sigils.create({
      projectId: project.id,
      name: "ours",
      tokenHash: "hash-ours",
      tokenPrefix: "sg_o",
      kinds: ["beacon"],
    });
    await expect(
      call(owner, tools.dashboard_card_add, {
        metric: "uniqueVisitors",
        scope: { kind: "apps", sigilIds: [theirs.id] },
      }),
    ).rejects.toThrow(/not found/i);
    await expect(
      call(owner, tools.dashboard_card_add, {
        metric: "activeQuests",
        scope: { kind: "apps", sigilIds: [ours.id] },
      }),
    ).rejects.toThrow(/does not accept a apps scope/);
  });

  it("lets a member read the cards and refuses them every write without project:update", async ({
    expect,
  }) => {
    const card = await call(owner, tools.dashboard_card_add, {
      metric: "openErrors",
    });
    expect((await call(member, tools.dashboard_card_list, {})).cards).toEqual([
      expect.objectContaining({ id: card.id }),
    ]);
    await expect(
      call(member, tools.dashboard_card_add, { metric: "openErrors" }),
    ).rejects.toThrow(/project:update/);
    await expect(
      call(member, tools.dashboard_card_update, { card: card.id, size: 2 }),
    ).rejects.toThrow(/project:update/);
    await expect(
      call(member, tools.dashboard_card_reorder, { ids: [card.id] }),
    ).rejects.toThrow(/project:update/);
    await expect(
      call(member, tools.dashboard_card_remove, { card: card.id }),
    ).rejects.toThrow(/project:update/);
  });

  it("refuses a stranger even the read", async ({ expect }) => {
    const stranger = await rows.users.create({
      email: "stranger@example.test",
      roles: ["user"],
    });
    await expect(
      call({ id: stranger.id, roles: ["user"] }, tools.dashboard_card_list, {}),
    ).rejects.toThrow();
  });
});
