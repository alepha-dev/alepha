import { DashboardMetricRegistry, DashboardSlotRegistry } from "@lore/core/api";
import type { DashboardCardValue, Project } from "@lore/core/schemas";
import { projectCapabilities } from "@lore/core/schemas";
import { releases } from "@lore/work/schemas";
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
  createTestEpic,
  createTestFolio,
  createTestMember,
  createTestProject,
  createTestQuest,
  TestEntityRepositories,
} from "./fixtures/entities.ts";

/**
 * Records every metric the board hands to a resolve.
 */
class RecordingRegistry extends DashboardMetricRegistry {
  public readonly resolved: string[] = [];

  override async resolveForProject(
    ...args: Parameters<DashboardMetricRegistry["resolveForProject"]>
  ): Promise<DashboardCardValue[]> {
    this.resolved.push(...args[0].map((card) => card.metric));
    return super.resolveForProject(...args);
  }
}

/**
 * The board as it was computed before #Q3493 when `onePass` is on: the
 * data gate asks for every candidate at once, so the first wave resolves
 * them all and the winners are chosen over the complete set.
 */
class OnePassSlots extends DashboardSlotRegistry {
  public onePass = false;

  protected override select(
    ...args: [
      slots: any,
      offered: any[],
      valueOf: Map<number, DashboardCardValue>,
    ]
  ) {
    const [, offered, valueOf] = args;
    const unresolved = offered.filter((it) => !valueOf.has(it.card.id));
    if (this.onePass && unresolved.length > 0) {
      return { winners: [], needed: unresolved };
    }
    return super.select(...args);
  }
}

class WaveRepositories extends TestEntityRepositories {
  capabilities = $repository(projectCapabilities);
  releaseRows = $repository(releases);
}

/**
 * The computed board resolves its candidates in rank waves (#Q3493): the
 * same board as resolving every candidate at once, without resolving the
 * candidates that lose to a better-ranked one.
 */
describe("dashboard rank waves", () => {
  let alepha: Alepha;
  let repos: WaveRepositories;
  let registry: RecordingRegistry;
  let slots: OnePassSlots;
  let dateTime: DateTimeProvider;
  let project: Project;
  let user: UserAccountToken;

  beforeEach(async () => {
    alepha = Alepha.create({
      env: { LOG_LEVEL: "error", DATABASE_URL: ":memory:" },
    });
    alepha.with({ provide: DashboardMetricRegistry, use: RecordingRegistry });
    alepha.with({ provide: DashboardSlotRegistry, use: OnePassSlots });
    alepha.with(AlephaOrm);
    alepha.with(AlephaServer);
    alepha.with(AlephaSecurity);
    alepha.with(AlephaEmail);
    alepha.with(AlephaApiUsers);
    bootLore(alepha);
    repos = alepha.inject(WaveRepositories);
    await alepha.start();
    registry = alepha.inject(DashboardMetricRegistry) as RecordingRegistry;
    slots = alepha.inject(DashboardSlotRegistry) as OnePassSlots;
    dateTime = alepha.inject(DateTimeProvider);
    project = await createTestProject(alepha);
    await createTestMember(alepha, project, project.createdBy!);
    user = { id: project.createdBy!, roles: ["user"] };

    // Every capability and option on, as on the project these were measured on.
    await repos.capabilities.deleteMany({ projectId: { eq: project.id } });
    const on = (keys: string[]) =>
      Object.fromEntries(keys.map((key) => [key, true]));
    for (const [key, options] of [
      ["work", on(["board", "epics", "releases", "reminder"])],
      ["knowledge", {}],
      ["apps", on(["track"])],
      ["support", {}],
    ] as const) {
      await repos.capabilities.create({
        projectId: project.id,
        key,
        options,
      });
    }
    // The capability read is cached for 30 s.
    await dateTime.travel(60, "second");
  });

  afterEach(async () => {
    await alepha.stop();
  });

  const both = async () => {
    slots.onePass = true;
    registry.resolved.length = 0;
    const before = await slots.compute(project, user);
    const resolvedBefore = [...registry.resolved];

    slots.onePass = false;
    registry.resolved.length = 0;
    const after = await slots.compute(project, user);
    const resolvedAfter = [...registry.resolved];

    return { before, after, resolvedBefore, resolvedAfter };
  };

  const seedBusyProject = async () => {
    const now = dateTime.now();
    const ready = await createTestEpic(alepha, project, { status: "ready" });
    await createTestEpic(alepha, project, { status: "draft" });
    await repos.releaseRows.create({
      projectId: project.id,
      number: 1,
      tag: "1.0.0",
      title: "Release 1",
    });
    for (let i = 0; i < 8; i += 1) {
      const at = now.subtract(i + 1, "day").toISOString();
      await createTestQuest(alepha, project, {
        acceptedAt: at,
        acceptedBy: user.id,
        completedAt: at,
        epicId: ready.id,
      });
    }
    await createTestQuest(alepha, project, {
      acceptedAt: now.subtract(20, "day").toISOString(),
      acceptedBy: user.id,
    });
    await createTestQuest(alepha, project, { priority: "high" });
    await createTestFolio(alepha, project, {
      pinned: true,
      content: "Read me",
    });
  };

  describe("the board", () => {
    it("is the same as resolving every candidate at once, on an empty project", async ({
      expect,
    }) => {
      const { before, after } = await both();

      expect(after).toEqual(before);
    });

    it("is the same as resolving every candidate at once, on a busy project", async ({
      expect,
    }) => {
      await seedBusyProject();

      const { before, after } = await both();

      expect(after.cards.length).toBeGreaterThan(3);
      expect(after).toEqual(before);
    });
  });

  describe("what is resolved", () => {
    it("leaves out the candidates that lose to a better-ranked one", async ({
      expect,
    }) => {
      await seedBusyProject();

      const { after, resolvedBefore, resolvedAfter } = await both();

      expect(resolvedAfter.length).toBeLessThan(resolvedBefore.length);
      // Every winner was resolved, and nothing was resolved twice.
      for (const card of after.cards) {
        expect(resolvedAfter).toContain(card.metric);
      }
      const perSlot = new Map<string, number>();
      for (const card of after.cards) {
        perSlot.set(card.slot!, (perSlot.get(card.slot!) ?? 0) + 1);
      }
      expect([...perSlot.values()].every((n) => n === 1)).toBe(true);
    });
  });
});
