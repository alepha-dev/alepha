import { ProjectDashboardController } from "@lore/core/api";
import {
  type Project,
  projectCapabilities,
  projectDashboardCards,
} from "@lore/core/schemas";
import { ReadCounter } from "@lore/core/testing";
import { sigils } from "@lore/deploy/schemas";
import { Alepha } from "alepha";
import { AlephaApiUsers } from "alepha/api/users";
import { DateTimeProvider } from "alepha/datetime";
import { AlephaEmail } from "alepha/email";
import { $repository, AlephaOrm } from "alepha/orm";
import type { UserAccountToken } from "alepha/security";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { afterEach, beforeEach, describe, it } from "vitest";

import { bootLore } from "./fixtures/bootLore.ts";
import {
  createTestMember,
  createTestProject,
  createTestQuest,
  TestEntityRepositories,
} from "./fixtures/entities.ts";

class ComputedRepositories {
  sigils = $repository(sigils);
  cards = $repository(projectDashboardCards);
  capabilities = $repository(projectCapabilities);
}

type Shape = Parameters<typeof createTestProject>[1];

/**
 * The computed default board (#E77, #Q2652, folio #F1364): a project with no
 * stored cards gets slots resolved live from its capabilities and its data,
 * and nothing is written.
 */
describe("the computed project board", () => {
  let alepha: Alepha;
  let repos: ComputedRepositories;
  let controller: ProjectDashboardController;
  let dateTime: DateTimeProvider;
  let seq = 0;

  beforeEach(async () => {
    alepha = Alepha.create({
      env: { LOG_LEVEL: "error", DATABASE_URL: ":memory:" },
    });
    alepha.with(AlephaOrm);
    alepha.with(AlephaServer);
    alepha.with(AlephaSecurity);
    alepha.with(AlephaEmail);
    alepha.with(AlephaApiUsers);
    bootLore(alepha);
    alepha.with(ReadCounter);
    alepha.inject(TestEntityRepositories);
    repos = alepha.inject(ComputedRepositories);
    await alepha.start();
    controller = alepha.inject(ProjectDashboardController);
    dateTime = alepha.inject(DateTimeProvider);
  });

  afterEach(async () => {
    await alepha.stop();
  });

  const projectOf = async (
    shape?: Shape,
  ): Promise<{ project: Project; user: UserAccountToken }> => {
    const project = await createTestProject(alepha, shape);
    await createTestMember(alepha, project, project.createdBy!);
    return { project, user: { id: project.createdBy!, roles: ["user"] } };
  };

  const load = async (project: Project, user: UserAccountToken) =>
    (
      await controller.getProjectDashboard.fetch(
        { params: { projectId: project.id } },
        { user },
      )
    ).data;

  /**
   * Which metric fills which slot, in board order.
   */
  const slots = async (project: Project, user: UserAccountToken) =>
    (await load(project, user)).cards.map((card) => [card.slot, card.metric]);

  const sigil = async (project: Project, kinds: string[], daysAgo?: number) => {
    seq += 1;
    return repos.sigils.create({
      projectId: project.id,
      name: `app-${seq}/production`,
      tokenHash: `computed-hash-${seq}`,
      tokenPrefix: `sg_c${seq}`,
      kinds,
      lastSeenAt:
        daysAgo === undefined
          ? undefined
          : dateTime.now().subtract(daysAgo, "day").toISOString(),
    });
  };

  describe("the survey's project shapes", () => {
    it("fills needs you and flow for a Work project with held and open quests", async ({
      expect,
    }) => {
      const { project, user } = await projectOf();
      await createTestQuest(alepha, project, {
        heldAt: dateTime.nowISOString(),
      });
      await createTestQuest(alepha, project);

      const board = await load(project, user);

      expect(board.computed).toBe(true);
      expect(board.cards.map((card) => [card.slot, card.metric])).toEqual([
        ["needsYou", "heldQuests"],
        ["flow", "activeQuests"],
      ]);
      // Every value is a real measurement: the computed board never carries
      // an empty or a failed tile.
      expect(board.values.every((value) => value.ok && !value.empty)).toBe(
        true,
      );
    });

    it("renders nothing, and so the empty state, for a project with nothing in it", async ({
      expect,
    }) => {
      const { project, user } = await projectOf();

      const board = await load(project, user);

      expect(board.computed).toBe(true);
      expect(board.cards).toEqual([]);
    });

    it("offers no Work tile to a Knowledge-only project", async ({
      expect,
    }) => {
      const { project, user } = await projectOf({
        capabilities: [{ key: "knowledge" }],
      });
      await createTestQuest(alepha, project);

      expect(await slots(project, user)).toEqual([]);
    });

    it("gives Apps without a sigil no apps slot", async ({ expect }) => {
      const { project, user } = await projectOf();

      const board = await load(project, user);

      expect(board.cards.some((card) => card.slot === "apps")).toBe(false);
    });

    it("gives a silent app with no beacon no apps slot", async ({ expect }) => {
      const { project, user } = await projectOf();
      await sigil(project, ["blights"], 40);

      const board = await load(project, user);

      expect(board.cards.some((card) => card.slot === "apps")).toBe(false);
    });

    it("fills the apps slot with blights for an app that reported this month", async ({
      expect,
    }) => {
      const { project, user } = await projectOf();
      await sigil(project, ["blights"], 1);

      expect(await slots(project, user)).toContainEqual([
        "apps",
        "openBlights",
      ]);
    });
  });

  describe("liveness", () => {
    it("drops the apps slot on the next load once tracking is switched off", async ({
      expect,
    }) => {
      const { project, user } = await projectOf();
      await sigil(project, ["blights"], 1);
      expect(await slots(project, user)).toContainEqual([
        "apps",
        "openBlights",
      ]);

      await repos.capabilities.updateMany(
        { projectId: { eq: project.id }, key: { eq: "apps" } },
        { options: { track: false } },
      );

      expect(
        (await slots(project, user)).some(([slot]) => slot === "apps"),
      ).toBe(false);
    });

    it("writes nothing", async ({ expect }) => {
      const { project, user } = await projectOf();
      await createTestQuest(alepha, project);

      await load(project, user);
      await load(project, user);

      expect(
        await repos.cards.findMany({
          where: { projectId: { eq: project.id } },
        }),
      ).toEqual([]);
    });

    it("lets stored cards win over the computed board", async ({ expect }) => {
      const { project, user } = await projectOf();
      await createTestQuest(alepha, project);
      await controller.addProjectDashboardCard.fetch(
        {
          params: { projectId: project.id },
          body: {
            metric: "heldQuests",
            scope: { kind: "projects", projectIds: [project.id] },
          },
        },
        { user },
      );

      const board = await load(project, user);

      expect(board.computed).toBe(false);
      expect(board.cards.map((card) => card.metric)).toEqual(["heldQuests"]);
      expect(board.cards[0]?.slot).toBeUndefined();
    });
  });
});
