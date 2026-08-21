import { Alepha } from "alepha";
import { AlephaApiUsers } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { $repository, AlephaOrm } from "alepha/orm";
import type { UserAccountToken } from "alepha/security";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { afterEach, beforeEach, describe, it } from "vitest";
import { DashboardController } from "@/api/controllers/DashboardController.ts";
import { dashboardCards } from "@/api/entities/dashboardCards.ts";
import { dashboardSettings } from "@/api/entities/dashboardSettings.ts";
import type { Project } from "@/api/entities/projects.ts";
import { sigils } from "@/api/entities/sigils.ts";
import { LoreApi } from "@/api/index.ts";
import {
  createTestMember,
  createTestProject,
  TestEntityRepositories,
} from "./fixtures/entities.ts";

/**
 * The FK closure this spec's rows reach, registered before `start()` — see
 * `TestEntityRepositories`' own doc for why that timing matters.
 */
class DashboardTestRepositories {
  sigils = $repository(sigils);
  cards = $repository(dashboardCards);
  settings = $repository(dashboardSettings);
}

interface TestContext {
  alepha: Alepha;
  controller: DashboardController;
  repos: TestEntityRepositories;
  dashboard: DashboardTestRepositories;
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
  alepha.with(LoreApi);

  const repos = alepha.inject(TestEntityRepositories);
  const dashboard = alepha.inject(DashboardTestRepositories);

  await alepha.start();

  return {
    alepha,
    controller: alepha.inject(DashboardController),
    repos,
    dashboard,
  };
};

const token = (id: string): UserAccountToken => ({ id, roles: ["user"] });

/** A user who is a member of one project. */
const memberOf = async (
  ctx: TestContext,
): Promise<{ user: UserAccountToken; project: Project }> => {
  const project = await createTestProject(ctx.alepha);
  await createTestMember(ctx.alepha, project, project.createdBy!);
  return { user: token(project.createdBy!), project };
};

describe("dashboard cards", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setup();
  });

  afterEach(async () => {
    await ctx.alepha.stop();
  });

  it("seeds a default card set on the first read", async ({ expect }) => {
    const { user } = await memberOf(ctx);

    const { cards } = await ctx.controller.listCards({}, { user });

    expect(cards.map((card) => card.metric)).toEqual([
      "activeQuests",
      "openBlights",
      "untriagedFeedback",
    ]);
    expect(cards.map((card) => card.position)).toEqual([0, 1, 2]);
  });

  it("seeds a visitors card when the user has a beacon app", async ({
    expect,
  }) => {
    const { user, project } = await memberOf(ctx);
    await ctx.dashboard.sigils.create({
      projectId: project.id,
      name: "docs",
      tokenHash: "hash-beacon",
      tokenPrefix: "sg_x",
      kinds: ["beacon"],
    });

    const { cards } = await ctx.controller.listCards({}, { user });

    expect(cards[0]?.metric).toBe("uniqueVisitors");
    expect(cards[0]?.scope.kind).toBe("apps");
  });

  it("does not offer visitors to a user whose only app has no beacon", async ({
    expect,
  }) => {
    const { user, project } = await memberOf(ctx);
    await ctx.dashboard.sigils.create({
      projectId: project.id,
      name: "api",
      tokenHash: "hash-blights",
      tokenPrefix: "sg_y",
      kinds: ["blights"],
    });

    const { cards } = await ctx.controller.listCards({}, { user });

    expect(cards.some((card) => card.metric === "uniqueVisitors")).toBe(false);
  });

  it("stays empty across reloads once the user removes every card", async ({
    expect,
  }) => {
    const { user } = await memberOf(ctx);
    const { cards } = await ctx.controller.listCards({}, { user });

    for (const card of cards) {
      await ctx.controller.removeCard(
        { params: { cardId: card.id } },
        { user },
      );
    }

    // The whole reason `dashboard_settings` exists: this second read sees
    // zero rows, exactly as the first one did, and must NOT re-seed.
    const after = await ctx.controller.listCards({}, { user });
    expect(after.cards).toEqual([]);
  });

  it("round-trips a card's scope and filters", async ({ expect }) => {
    const { user, project } = await memberOf(ctx);

    const created = await ctx.controller.addCard(
      {
        body: {
          metric: "activeQuests",
          scope: { kind: "projects", projectIds: [project.id] },
          filters: { statuses: ["new"] },
          size: 2,
        },
      },
      { user },
    );

    const { cards } = await ctx.controller.listCards({}, { user });
    const stored = cards.find((card) => card.id === created.id);

    expect(stored?.scope).toEqual({
      kind: "projects",
      projectIds: [project.id],
    });
    expect(stored?.filters).toEqual({ statuses: ["new"] });
    expect(stored?.size).toBe(2);
  });

  it("fills a card's filters from the metric's defaults", async ({
    expect,
  }) => {
    const { user } = await memberOf(ctx);

    const created = await ctx.controller.addCard(
      { body: { metric: "activeQuests", scope: { kind: "all" } } },
      { user },
    );

    expect(created.filters).toEqual({ statuses: ["new", "accepted"] });
  });

  it("degrades a card whose stored filters no longer parse", async ({
    expect,
  }) => {
    const { user } = await memberOf(ctx);
    const created = await ctx.controller.addCard(
      { body: { metric: "activeQuests", scope: { kind: "all" } } },
      { user },
    );
    // Simulates a card written before the metric's vocabulary changed.
    await ctx.dashboard.cards.updateOne(
      { id: { eq: created.id } },
      { filters: { statuses: ["nonsense"] } },
    );

    const { cards } = await ctx.controller.listCards({}, { user });

    expect(cards.find((card) => card.id === created.id)?.filters).toEqual({
      statuses: ["new", "accepted"],
    });
  });

  it("refuses a scope naming a project the caller cannot see", async ({
    expect,
  }) => {
    const { user } = await memberOf(ctx);
    const stranger = await createTestProject(ctx.alepha);

    await expect(
      ctx.controller.addCard(
        {
          body: {
            metric: "activeQuests",
            scope: { kind: "projects", projectIds: [stranger.id] },
          },
        },
        { user },
      ),
    ).rejects.toThrowError(/Project not found/);
  });

  it("refuses a scope naming an app in someone else's project", async ({
    expect,
  }) => {
    const { user } = await memberOf(ctx);
    const stranger = await createTestProject(ctx.alepha);
    const theirApp = await ctx.dashboard.sigils.create({
      projectId: stranger.id,
      name: "theirs",
      tokenHash: "hash-stranger",
      tokenPrefix: "sg_s",
      kinds: ["beacon"],
    });

    // "No such app here" rather than an empty window: the two are different
    // answers, and only one of them is true.
    await expect(
      ctx.controller.addCard(
        {
          body: {
            metric: "uniqueVisitors",
            scope: { kind: "apps", sigilIds: [theirApp.id] },
          },
        },
        { user },
      ),
    ).rejects.toThrowError(/App not found/);
  });

  it("refuses an app id that exists nowhere", async ({ expect }) => {
    const { user } = await memberOf(ctx);

    await expect(
      ctx.controller.addCard(
        {
          body: {
            metric: "uniqueVisitors",
            scope: { kind: "apps", sigilIds: [crypto.randomUUID()] },
          },
        },
        { user },
      ),
    ).rejects.toThrowError(/App not found/);
  });

  it("refuses a scope kind the metric does not accept", async ({ expect }) => {
    const { user, project } = await memberOf(ctx);
    const sigil = await ctx.dashboard.sigils.create({
      projectId: project.id,
      name: "docs",
      tokenHash: "hash-reject",
      tokenPrefix: "sg_z",
      kinds: ["beacon"],
    });

    await expect(
      ctx.controller.addCard(
        {
          body: {
            metric: "activeQuests",
            scope: { kind: "apps", sigilIds: [sigil.id] },
          },
        },
        { user },
      ),
    ).rejects.toThrowError(/does not accept a apps scope/);
  });

  it("refuses a scope carrying a payload its kind does not call for", async ({
    expect,
  }) => {
    const { user, project } = await memberOf(ctx);

    await expect(
      ctx.controller.addCard(
        {
          body: {
            metric: "activeQuests",
            scope: { kind: "all", projectIds: [project.id] },
          },
        },
        { user },
      ),
    ).rejects.toThrowError(/must not carry projectIds/);
  });

  it("persists a new grid order", async ({ expect }) => {
    const { user } = await memberOf(ctx);
    const { cards } = await ctx.controller.listCards({}, { user });
    const reversed = [...cards].reverse().map((card) => card.id);

    await ctx.controller.reorderCards({ body: { ids: reversed } }, { user });

    const after = await ctx.controller.listCards({}, { user });
    expect(after.cards.map((card) => card.id)).toEqual(reversed);
  });

  it("refuses a reorder that does not list every card", async ({ expect }) => {
    const { user } = await memberOf(ctx);
    const { cards } = await ctx.controller.listCards({}, { user });

    await expect(
      ctx.controller.reorderCards({ body: { ids: [cards[0]!.id] } }, { user }),
    ).rejects.toThrowError(/every card exactly once/);
  });

  it("restores the default set on reset, and keeps the board empty-able after", async ({
    expect,
  }) => {
    const { user } = await memberOf(ctx);
    const { cards } = await ctx.controller.listCards({}, { user });
    for (const card of cards) {
      await ctx.controller.removeCard(
        { params: { cardId: card.id } },
        { user },
      );
    }

    const reset = await ctx.controller.resetLayout({}, { user });
    expect(reset.cards.map((card) => card.metric)).toEqual([
      "activeQuests",
      "openBlights",
      "untriagedFeedback",
    ]);

    for (const card of reset.cards) {
      await ctx.controller.removeCard(
        { params: { cardId: card.id } },
        { user },
      );
    }
    const after = await ctx.controller.listCards({}, { user });
    expect(after.cards).toEqual([]);
  });

  it("never returns or mutates another user's cards", async ({ expect }) => {
    const mine = await memberOf(ctx);
    const theirs = await memberOf(ctx);

    const { cards } = await ctx.controller.listCards({}, { user: mine.user });
    const foreign = cards[0]!;

    await expect(
      ctx.controller.removeCard(
        { params: { cardId: foreign.id } },
        { user: theirs.user },
      ),
    ).rejects.toThrowError(/Card not found/);
  });
});
