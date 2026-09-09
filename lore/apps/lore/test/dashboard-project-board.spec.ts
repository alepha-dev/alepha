import { Alepha } from "alepha";
import { RankService } from "alepha/api/ranks";
import { AlephaApiUsers } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { $repository, AlephaOrm } from "alepha/orm";
import { AlephaSecurity, type UserAccountToken } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { afterEach, beforeEach, describe, it } from "vitest";

import { ProjectController } from "@/api/controllers/ProjectController.ts";
import { ProjectDashboardController } from "@/api/controllers/ProjectDashboardController.ts";
import { projectDashboardCards } from "@/api/entities/projectDashboardCards.ts";
import { LoreApi } from "@/api/index.ts";

import {
  createTestEpic,
  createTestProject,
  createTestQuest,
  TestEntityRepositories,
} from "./fixtures/entities.ts";

/**
 * The project board's endpoints: one membership gate, a scope proved inside
 * the project, and a write gate that most members do not hold.
 *
 * Driven through `.fetch(...)` rather than by calling the handlers, because
 * the gate IS the `use:` chain: a spec that calls a handler directly would
 * stay green with every gate deleted.
 */
class BoardTestRepositories {
  cards = $repository(projectDashboardCards);
}

interface TestContext {
  alepha: Alepha;
  board: ProjectDashboardController;
  projects: ProjectController;
  repos: TestEntityRepositories;
  boardRepos: BoardTestRepositories;
}

const setup = async (): Promise<TestContext> => {
  const alepha = Alepha.create({
    env: { LOG_LEVEL: "error", SERVER_PORT: 0, DATABASE_URL: ":memory:" },
  });

  alepha.with(AlephaOrm);
  alepha.with(AlephaServer);
  alepha.with(AlephaSecurity);
  alepha.with(AlephaEmail);
  alepha.with(AlephaApiUsers);
  alepha.with(LoreApi);

  const repos = alepha.inject(TestEntityRepositories);
  const boardRepos = alepha.inject(BoardTestRepositories);

  await alepha.start();

  return {
    alepha,
    board: alepha.inject(ProjectDashboardController),
    projects: alepha.inject(ProjectController),
    repos,
    boardRepos,
  };
};

const token = (id: string): UserAccountToken => ({ id, roles: ["user"] });

/**
 * A project created through the real controller, so its three preset ranks
 * are seeded. `createTestProject` bypasses that on purpose and would leave
 * `contributor` naming nothing.
 */
const ownedProject = async (
  ctx: TestContext,
): Promise<{ owner: UserAccountToken; projectId: number }> => {
  const owner = token(crypto.randomUUID());
  await ctx.repos.users.create({ id: owner.id });
  const created = await ctx.projects.createProject.fetch(
    { body: { title: `Board ${crypto.randomUUID().slice(0, 8)}` } },
    { user: owner },
  );
  return { owner, projectId: created.data.id };
};

/**
 * A second member holding the Contributor preset.
 *
 * ⚠️ The rank most real members hold, and the read-only case for this board:
 * `ProjectRankPresets.CONTRIBUTOR` carries `project:read` and not
 * `project:update`, which is the consequence A1 of the epic accepted rather
 * than worked around.
 */
const contributorOf = async (
  ctx: TestContext,
  projectId: number,
): Promise<UserAccountToken> => {
  const user = token(crypto.randomUUID());
  await ctx.repos.users.create({ id: user.id });
  await ctx.repos.members.create({
    projectId,
    userId: user.id,
    rank: "contributor",
  });
  return user;
};

const addHeldCard = async (
  ctx: TestContext,
  projectId: number,
  user: UserAccountToken,
) =>
  ctx.board.addProjectDashboardCard.fetch(
    {
      params: { projectId },
      body: {
        metric: "heldQuests",
        scope: { kind: "projects" as const, projectIds: [projectId] },
      },
    },
    { user },
  );

describe("the project dashboard controller", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setup();
  });

  afterEach(async () => {
    await ctx.alepha.stop();
  });

  describe("the board opens empty", () => {
    it("answers an empty array on a project nobody has curated", async ({
      expect,
    }) => {
      const { owner, projectId } = await ownedProject(ctx);

      const res = await ctx.board.listProjectDashboardCards.fetch(
        { params: { projectId } },
        { user: owner },
      );

      expect(res.data.cards).toEqual([]);
    });

    it("writes nothing on the way", async ({ expect }) => {
      const { owner, projectId } = await ownedProject(ctx);

      // Read it twice, the way a page mounting and remounting would. Nothing
      // seeds, so there is no marker to stamp and no default set to write.
      await ctx.board.listProjectDashboardCards.fetch(
        { params: { projectId } },
        { user: owner },
      );
      await ctx.board.listProjectDashboardCards.fetch(
        { params: { projectId } },
        { user: owner },
      );

      const rows = await ctx.boardRepos.cards.findMany({
        where: { projectId: { eq: projectId } },
      });
      expect(rows).toEqual([]);
    });
  });

  describe("the scope is the route's project", () => {
    it("forces an all scope onto this project", async ({ expect }) => {
      const { owner, projectId } = await ownedProject(ctx);

      const res = await ctx.board.addProjectDashboardCard.fetch(
        {
          params: { projectId },
          body: { metric: "heldQuests", scope: { kind: "all" } },
        },
        { user: owner },
      );

      // ⚠️ Rewritten server-side rather than refused. Inside a project `all`
      // means the project, and the reader was never asked - see
      // `DashboardMetricCatalog.forcedScope`.
      expect(res.data.scope).toEqual({
        kind: "projects",
        projectIds: [projectId],
      });
    });

    it("refuses to point a card at another project", async ({ expect }) => {
      const { owner, projectId } = await ownedProject(ctx);
      const elsewhere = await ownedProject(ctx);

      const res = await ctx.board.addProjectDashboardCard.fetch(
        {
          params: { projectId },
          body: {
            metric: "heldQuests",
            scope: { kind: "projects", projectIds: [elsewhere.projectId] },
          },
        },
        { user: owner },
      );

      // Forced, not honoured. The body cannot widen what the route decided,
      // which is the whole reason the id is taken from the param.
      expect(res.data.scope).toEqual({
        kind: "projects",
        projectIds: [projectId],
      });
    });

    it("answers 404 for an epic that belongs to another project", async ({
      expect,
    }) => {
      const { owner, projectId } = await ownedProject(ctx);
      const stranger = await createTestProject(ctx.alepha);
      const epic = await createTestEpic(ctx.alepha, stranger);

      await expect(
        ctx.board.addProjectDashboardCard.fetch(
          {
            params: { projectId },
            body: {
              metric: "heldQuests",
              scope: { kind: "epic", epicId: epic.id },
            },
          },
          { user: owner },
        ),
      ).rejects.toThrowError(/Epic not found/);
    });

    it("refuses a metric that does not belong on a project board", async ({
      expect,
    }) => {
      const { owner, projectId } = await ownedProject(ctx);

      await expect(
        ctx.board.addProjectDashboardCard.fetch(
          {
            params: { projectId },
            body: { metric: "uniqueVisitors", scope: { kind: "all" } },
          },
          { user: owner },
        ),
      ).rejects.toThrowError(/does not accept/);
    });
  });

  describe("filters", () => {
    it("degrades an unreadable stored filter set to the metric's defaults", async ({
      expect,
    }) => {
      const { owner, projectId } = await ownedProject(ctx);
      const made = await addHeldCard(ctx, projectId, owner);

      // Written straight to the row, the way a card stored before a metric's
      // vocabulary changed would look. It must never reach the browser as a
      // shape nothing understands.
      await ctx.boardRepos.cards.updateOne(
        { id: { eq: made.data.id } },
        { metric: "activeQuests", filters: { statuses: ["nonsense"] } },
      );

      const res = await ctx.board.listProjectDashboardCards.fetch(
        { params: { projectId } },
        { user: owner },
      );

      expect(res.data.cards[0]?.filters).toEqual({
        statuses: ["new", "accepted"],
      });
    });

    it("refuses filters the metric does not understand, on write", async ({
      expect,
    }) => {
      const { owner, projectId } = await ownedProject(ctx);

      await expect(
        ctx.board.addProjectDashboardCard.fetch(
          {
            params: { projectId },
            body: {
              metric: "activeQuests",
              scope: { kind: "all" },
              filters: { statuses: ["nonsense"] },
            },
          },
          { user: owner },
        ),
      ).rejects.toThrowError(/Invalid filters/);
    });
  });

  describe("reorder", () => {
    it("refuses a partial id list", async ({ expect }) => {
      const { owner, projectId } = await ownedProject(ctx);
      const first = await addHeldCard(ctx, projectId, owner);
      await addHeldCard(ctx, projectId, owner);

      await expect(
        ctx.board.reorderProjectDashboardCards.fetch(
          { params: { projectId }, body: { ids: [first.data.id] } },
          { user: owner },
        ),
      ).rejects.toThrowError(/every card exactly once/);
    });

    it("applies a complete one", async ({ expect }) => {
      const { owner, projectId } = await ownedProject(ctx);
      const first = await addHeldCard(ctx, projectId, owner);
      const second = await addHeldCard(ctx, projectId, owner);

      const res = await ctx.board.reorderProjectDashboardCards.fetch(
        {
          params: { projectId },
          body: { ids: [second.data.id, first.data.id] },
        },
        { user: owner },
      );

      expect(res.data.cards.map((it) => it.id)).toEqual([
        second.data.id,
        first.data.id,
      ]);
    });
  });

  describe("resolve", () => {
    it("answers the project's own numbers", async ({ expect }) => {
      const { owner, projectId } = await ownedProject(ctx);
      const project = await ctx.repos.projects.getOne({
        where: { id: { eq: projectId } },
      });
      await createTestQuest(ctx.alepha, project, {
        title: "parked",
        heldAt: new Date().toISOString(),
        createdBy: owner.id,
      });
      const made = await addHeldCard(ctx, projectId, owner);

      const res = await ctx.board.resolveProjectDashboardCards.fetch(
        { params: { projectId }, body: {} },
        { user: owner },
      );

      const value = res.data.values.find((it) => it.cardId === made.data.id);
      expect(value?.ok).toBe(true);
      expect(value?.value).toBe(1);
      expect(res.data.refreshedAt).toBeTruthy();
    });
  });

  /**
   * The gate, from both sides.
   *
   * ⚠️ This is the common case, not the corner one. Under `project:update`
   * (A1 of epic #E46) a Contributor gets a board they can read and not
   * change, and Contributor is the rank most real members hold.
   */
  describe("a Contributor reads the board and cannot change it", () => {
    it("holds the rank the presets seeded, and it carries project:read only", async ({
      expect,
    }) => {
      const { projectId } = await ownedProject(ctx);
      const reader = await contributorOf(ctx, projectId);

      // The rank the fixture names has to be a real seeded definition. If it
      // resolved to nothing the member would fall back to the built-in
      // `member` rank, and every refusal below would still pass while proving
      // nothing about Contributor.
      const held = await ctx.alepha
        .inject(RankService)
        .permissionsOf("project", String(projectId), "contributor");

      expect(held).toContain("project:read");
      expect(held).not.toContain("project:update");
      expect(
        (
          await ctx.repos.members.getOne({
            where: { projectId: { eq: projectId }, userId: { eq: reader.id } },
          })
        ).rank,
      ).toBe("contributor");
    });

    it("reads the card list and resolves it", async ({ expect }) => {
      const { owner, projectId } = await ownedProject(ctx);
      await addHeldCard(ctx, projectId, owner);
      const reader = await contributorOf(ctx, projectId);

      const list = await ctx.board.listProjectDashboardCards.fetch(
        { params: { projectId } },
        { user: reader },
      );
      expect(list.data.cards).toHaveLength(1);

      const resolved = await ctx.board.resolveProjectDashboardCards.fetch(
        { params: { projectId }, body: {} },
        { user: reader },
      );
      expect(resolved.data.values).toHaveLength(1);
    });

    it("is refused every write", async ({ expect }) => {
      const { owner, projectId } = await ownedProject(ctx);
      const made = await addHeldCard(ctx, projectId, owner);
      const reader = await contributorOf(ctx, projectId);

      // ⚠️ Asserted on the PERMISSION, not merely that something threw. A
      // rank name that resolved to nothing would fall back to the built-in
      // `member`, which also lacks `project:update`, and the test would pass
      // for a reason that has nothing to do with Contributor.
      await expect(
        ctx.board.addProjectDashboardCard.fetch(
          {
            params: { projectId },
            body: { metric: "heldQuests", scope: { kind: "all" } },
          },
          { user: reader },
        ),
      ).rejects.toThrowError(/project:update/);

      await expect(
        ctx.board.updateProjectDashboardCard.fetch(
          { params: { projectId, cardId: made.data.id }, body: { size: 2 } },
          { user: reader },
        ),
      ).rejects.toThrow();

      await expect(
        ctx.board.removeProjectDashboardCard.fetch(
          { params: { projectId, cardId: made.data.id } },
          { user: reader },
        ),
      ).rejects.toThrow();

      await expect(
        ctx.board.reorderProjectDashboardCards.fetch(
          { params: { projectId }, body: { ids: [made.data.id] } },
          { user: reader },
        ),
      ).rejects.toThrow();

      // And nothing was written by any of them.
      const rows = await ctx.boardRepos.cards.findMany({
        where: { projectId: { eq: projectId } },
      });
      expect(rows).toHaveLength(1);
      expect(rows[0]?.size).toBe(1);
    });

    it("refuses a stranger outright", async ({ expect }) => {
      const { projectId } = await ownedProject(ctx);
      const stranger = token(crypto.randomUUID());
      await ctx.repos.users.create({ id: stranger.id });

      await expect(
        ctx.board.listProjectDashboardCards.fetch(
          { params: { projectId } },
          { user: stranger },
        ),
      ).rejects.toThrow();
    });
  });

  /**
   * ⚠️ There is no reset, on either board. On a shared one it is a member
   * discarding everybody's configuration in one click, and home's is deleted
   * in #Q2145 - so there is no surface left to mirror.
   */
  it("declares no reset action", ({ expect }) => {
    expect(
      Object.keys(ctx.board).some((key) => key.toLowerCase().includes("reset")),
    ).toBe(false);
  });
});
