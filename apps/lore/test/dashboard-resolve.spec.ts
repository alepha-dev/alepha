import { Alepha, z } from "alepha";
import { AlephaApiUsers } from "alepha/api/users";
import { DateTimeProvider } from "alepha/datetime";
import { AlephaEmail } from "alepha/email";
import { $repository, AlephaOrm } from "alepha/orm";
import type { UserAccountToken } from "alepha/security";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { afterEach, beforeEach, describe, it } from "vitest";

import { DashboardController } from "@/api/controllers/DashboardController.ts";
import { blights } from "@/api/entities/blights.ts";
import { dashboardCards } from "@/api/entities/dashboardCards.ts";
import { dashboardSettings } from "@/api/entities/dashboardSettings.ts";
import { feedback } from "@/api/entities/feedback.ts";
import type { Project } from "@/api/entities/projects.ts";
import { releases } from "@/api/entities/releases.ts";
import { sigilErrorGroups } from "@/api/entities/sigilErrorGroups.ts";
import { type Sigil, sigils } from "@/api/entities/sigils.ts";
import { sigilUniquesDaily } from "@/api/entities/sigilUniquesDaily.ts";
import { LoreApi } from "@/api/index.ts";
import type { DashboardScope } from "@/api/schemas/dashboardScopeSchema.ts";
import { DashboardMetricRegistry } from "@/api/services/DashboardMetricRegistry.ts";
import { DashboardScopeService } from "@/api/services/DashboardScopeService.ts";
import { EpicProgressService } from "@/api/services/EpicProgressService.ts";
import { ProjectSecurityService } from "@/api/services/ProjectSecurityService.ts";
import { QuestTagTallyService } from "@/api/services/QuestTagTallyService.ts";

import {
  createTestEpic,
  createTestMember,
  createTestProject,
  createTestQuest,
  TestEntityRepositories,
} from "./fixtures/entities.ts";
import { ReadCounter } from "./fixtures/ReadCounter.ts";

class ResolveTestRepositories {
  sigils = $repository(sigils);
  blights = $repository(blights);
  errorGroups = $repository(sigilErrorGroups);
  uniques = $repository(sigilUniquesDaily);
  feedback = $repository(feedback);
  cards = $repository(dashboardCards);
  settings = $repository(dashboardSettings);
  releases = $repository(releases);
}

interface TestContext {
  alepha: Alepha;
  controller: DashboardController;
  repos: ResolveTestRepositories;
  dateTime: DateTimeProvider;
  counter: ReadCounter;
  /**
   * Injected before `start()`, because the container locks afterwards and a
   * subclass is a service the graph has not seen.
   */
  registry: TestDashboardMetricRegistry;
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
  alepha.with(ReadCounter);

  alepha.inject(TestEntityRepositories);
  const repos = alepha.inject(ResolveTestRepositories);
  const registry = alepha.inject(TestDashboardMetricRegistry);

  await alepha.start();

  return {
    alepha,
    controller: alepha.inject(DashboardController),
    repos,
    registry,
    dateTime: alepha.inject(DateTimeProvider),
    counter: alepha.inject(ReadCounter),
  };
};

const token = (id: string): UserAccountToken => ({ id, roles: ["user"] });

const memberOf = async (
  ctx: TestContext,
): Promise<{ user: UserAccountToken; project: Project }> => {
  const project = await createTestProject(ctx.alepha);
  await createTestMember(ctx.alepha, project, project.createdBy!);
  return { user: token(project.createdBy!), project };
};

/**
 * Replace the seeded set with exactly the cards a test is about.
 */
const only = async (
  ctx: TestContext,
  user: UserAccountToken,
  cards: Array<{
    metric: string;
    scope: DashboardScope;
    filters?: Record<string, unknown>;
  }>,
): Promise<number[]> => {
  const seeded = await ctx.controller.listCards({}, { user });
  for (const card of seeded.cards) {
    await ctx.controller.removeCard({ params: { cardId: card.id } }, { user });
  }
  const ids: number[] = [];
  for (const card of cards) {
    const made = await ctx.controller.addCard({ body: card }, { user });
    ids.push(made.id);
  }
  return ids;
};

/**
 * `narrow()` is protected, and it is where the capability rule actually runs.
 * A subclass is how this repo unit-tests one, rather than reaching for a mock.
 */
class TestDashboardMetricRegistry extends DashboardMetricRegistry {
  public testNarrow = this.narrow.bind(this);
}

let tokenSeq = 0;

const createSigil = async (
  ctx: TestContext,
  project: Project,
  name: string,
  kinds: string[],
): Promise<Sigil> => {
  tokenSeq += 1;
  return ctx.repos.sigils.create({
    projectId: project.id,
    name,
    tokenHash: `resolve-hash-${tokenSeq}`,
    tokenPrefix: `sg_r${tokenSeq}`,
    kinds,
  });
};

/**
 * `YYYY-MM-DD` for `daysAgo` days before the container's clock, UTC.
 */
const dayUtc = (ctx: TestContext, daysAgo: number): string => {
  const day = new Date(ctx.dateTime.nowMillis());
  day.setUTCDate(day.getUTCDate() - daysAgo);
  return day.toISOString().slice(0, 10);
};

describe("dashboard resolve", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setup();
  });

  afterEach(async () => {
    await ctx.alepha.stop();
  });

  describe("activeQuests", () => {
    it("counts new + accepted and splits them in the footer", async ({
      expect,
    }) => {
      const { user, project } = await memberOf(ctx);
      await createTestQuest(ctx.alepha, project, { title: "one" });
      await createTestQuest(ctx.alepha, project, { title: "two" });
      await createTestQuest(ctx.alepha, project, {
        title: "in flight",
        acceptedAt: new Date(ctx.dateTime.nowMillis()).toISOString(),
      });
      await createTestQuest(ctx.alepha, project, {
        title: "done",
        completedAt: new Date(ctx.dateTime.nowMillis()).toISOString(),
      });
      await createTestQuest(ctx.alepha, project, {
        title: "shelved",
        shelvedAt: new Date(ctx.dateTime.nowMillis()).toISOString(),
      });

      await only(ctx, user, [
        { metric: "activeQuests", scope: { kind: "all" } },
      ]);
      const { values } = await ctx.controller.resolveCards(
        { body: {} },
        { user },
      );

      expect(values[0]).toMatchObject({
        ok: true,
        value: 3,
        detail: { todoCount: 2, inProgressCount: 1 },
      });
    });

    it("excludes quests inside a draft epic, exactly as the list does", async ({
      expect,
    }) => {
      const { user, project } = await memberOf(ctx);
      const draft = await createTestEpic(ctx.alepha, project, {
        status: "draft",
      });
      const active = await createTestEpic(ctx.alepha, project, {
        status: "in_progress",
      });
      await createTestQuest(ctx.alepha, project, { epicId: draft.id });
      await createTestQuest(ctx.alepha, project, { epicId: active.id });
      await createTestQuest(ctx.alepha, project);

      await only(ctx, user, [
        { metric: "activeQuests", scope: { kind: "all" } },
      ]);
      const { values } = await ctx.controller.resolveCards(
        { body: {} },
        { user },
      );

      // The one thing a drill-through must never do is disagree with the list
      // it opens. A draft epic's quests are not in that list.
      expect(values[0]?.value).toBe(2);
    });

    it("links to status=todo even though it counted new + accepted", async ({
      expect,
    }) => {
      const { user, project } = await memberOf(ctx);
      await createTestQuest(ctx.alepha, project);

      await only(ctx, user, [
        {
          metric: "activeQuests",
          scope: { kind: "projects", projectIds: [project.id] },
        },
      ]);
      const { values } = await ctx.controller.resolveCards(
        { body: {} },
        { user },
      );

      expect(values[0]?.link).toEqual({
        route: "projectQuests",
        params: { projectSlug: project.slug },
        query: { status: "todo" },
      });
    });

    it("counts across every project the caller belongs to", async ({
      expect,
    }) => {
      const mine = await memberOf(ctx);
      const second = await createTestProject(ctx.alepha, {
        createdBy: mine.project.createdBy,
      });
      await createTestMember(ctx.alepha, second, mine.user.id);
      const stranger = await createTestProject(ctx.alepha);

      await createTestQuest(ctx.alepha, mine.project);
      await createTestQuest(ctx.alepha, second);
      await createTestQuest(ctx.alepha, second);
      await createTestQuest(ctx.alepha, stranger);

      await only(ctx, mine.user, [
        { metric: "activeQuests", scope: { kind: "all" } },
      ]);
      const { values } = await ctx.controller.resolveCards(
        { body: {} },
        { user: mine.user },
      );

      expect(values[0]?.value).toBe(3);
      // The drill-through picks the project holding most of the number, not
      // whichever row came back first.
      expect(values[0]?.link?.params?.projectSlug).toBe(second.slug);
    });
  });

  /**
   * The On hold card. Its whole contract is a containment: the number must be
   * a subset of the Active Quests card beside it, from the same
   * `OpenQuestScope`, or "Quests 12 / On hold 3" stops meaning what it reads
   * as.
   */
  describe("heldQuests", () => {
    /**
     * One card on the project board, resolved through the project entry
     * point. Built here rather than added through a controller so this spec
     * stays about the metric.
     */
    const resolveHeld = async (project: Project, user: UserAccountToken) => {
      const values = await ctx.alepha
        .inject(DashboardMetricRegistry)
        .resolveForProject(
          [
            {
              id: 1,
              metric: "heldQuests",
              scope: { kind: "projects", projectIds: [project.id] },
              filters: {},
              size: 1,
              position: 0,
            },
          ],
          user,
          project,
        );
      return values[0]!;
    };

    it("counts the open quests that are parked, and says what of", async ({
      expect,
    }) => {
      const { user, project } = await memberOf(ctx);
      await createTestQuest(ctx.alepha, project, { title: "open" });
      await createTestQuest(ctx.alepha, project, {
        title: "parked",
        heldAt: new Date().toISOString(),
      });
      await createTestQuest(ctx.alepha, project, {
        title: "also parked",
        acceptedAt: new Date().toISOString(),
        heldAt: new Date().toISOString(),
      });

      const value = await resolveHeld(project, user);

      expect(value.ok).toBe(true);
      expect(value.value).toBe(2);
      // The denominator the card is a subset of, so the footer can say
      // "of 3 open quests" and a reader can check the containment.
      expect(value.detail.open).toBe(3);
    });

    it("stays a subset of Active quests: completed and shelved are out", async ({
      expect,
    }) => {
      const { user, project } = await memberOf(ctx);
      await createTestQuest(ctx.alepha, project, { title: "open" });
      // ⚠️ Both of these carry `heldAt` and neither may be counted. A hold is
      // not cleared on the way out, so a resolver that looked at `heldAt`
      // alone would report work that is finished or declined.
      await createTestQuest(ctx.alepha, project, {
        title: "finished while held",
        heldAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
      });
      await createTestQuest(ctx.alepha, project, {
        title: "shelved while held",
        heldAt: new Date().toISOString(),
        shelvedAt: new Date().toISOString(),
      });

      const value = await resolveHeld(project, user);

      expect(value.value).toBe(0);
      expect(value.detail.open).toBe(1);
    });

    it("honours the draft-epic backlog gate, like the card beside it", async ({
      expect,
    }) => {
      const { user, project } = await memberOf(ctx);
      const draft = await createTestEpic(ctx.alepha, project, {
        status: "draft",
      });
      await createTestQuest(ctx.alepha, project, {
        title: "held inside a draft epic",
        epicId: draft.id,
        heldAt: new Date().toISOString(),
      });
      await createTestQuest(ctx.alepha, project, {
        title: "held in the open backlog",
        heldAt: new Date().toISOString(),
      });

      const value = await resolveHeld(project, user);

      // A quest parked inside a draft epic is out of the Active Quests
      // count by design, so counting it here would put a number on the board
      // larger than the card beside it can account for.
      expect(value.value).toBe(1);
      expect(value.detail.open).toBe(1);
    });

    it("links to the quest list already filtered to held", async ({
      expect,
    }) => {
      const { user, project } = await memberOf(ctx);
      await createTestQuest(ctx.alepha, project, {
        title: "parked",
        heldAt: new Date().toISOString(),
      });

      const value = await resolveHeld(project, user);

      expect(value.link?.route).toBe("projectQuests");
      expect(value.link?.params?.projectSlug).toBe(project.slug);
      // ⚠️ Asserted to ARRIVE filtered. `?status=on_hold` decodes only because
      // `boardFiltersSchema.status` is derived from `questStatusSchema`; when
      // it was a hand-written four-value enum the param was dropped and this
      // link opened the whole list.
      expect(value.link?.query).toEqual({ status: "on_hold" });
    });

    it("answers zero rather than failing when the project turned Work off", async ({
      expect,
    }) => {
      const project = await createTestProject(ctx.alepha, {
        capabilities: [{ key: "knowledge" }],
      });
      await createTestMember(ctx.alepha, project, project.createdBy!);
      await createTestQuest(ctx.alepha, project, {
        title: "still parked, still hidden",
        heldAt: new Date().toISOString(),
      });

      const value = await resolveHeld(project, token(project.createdBy!));

      // Zero, not `ok: false`: the project genuinely has no Work surface, and
      // "unreadable" is reserved for a scope that cannot be proven at all.
      expect(value.ok).toBe(true);
      expect(value.value).toBe(0);
    });
  });

  /**
   * The epic card, and the denominator two surfaces have to agree about.
   */
  describe("epicProgress", () => {
    const resolveEpic = async (
      project: Project,
      user: UserAccountToken,
      epicId: number,
    ) => {
      const values = await ctx.alepha
        .inject(DashboardMetricRegistry)
        .resolveForProject(
          [
            {
              id: 1,
              metric: "epicProgress",
              scope: { kind: "epic", epicId },
              filters: {},
              size: 1,
              position: 0,
            },
          ],
          user,
          project,
        );
      return values[0]!;
    };

    it("divides by total minus shelved, and says what it divided by", async ({
      expect,
    }) => {
      const { user, project } = await memberOf(ctx);
      const epic = await createTestEpic(ctx.alepha, project, {
        status: "in_progress",
      });
      const now = new Date().toISOString();
      await createTestQuest(ctx.alepha, project, {
        epicId: epic.id,
        completedAt: now,
      });
      await createTestQuest(ctx.alepha, project, {
        epicId: epic.id,
        acceptedAt: now,
      });
      await createTestQuest(ctx.alepha, project, { epicId: epic.id });
      await createTestQuest(ctx.alepha, project, {
        epicId: epic.id,
        shelvedAt: now,
      });

      const value = await resolveEpic(project, user, epic.id);

      // ⚠️ 1 of 3, not 1 of 4. The rollup's own `total` counts the shelved
      // quest; the subtraction happens here, at the card, because four other
      // surfaces read that number.
      expect(value.value).toBe(33);
      expect(value.detail.total).toBe(4);
      expect(value.detail.shelved).toBe(1);
      expect(value.detail.denominator).toBe(3);
    });

    it("renders no number rather than NaN when every quest is shelved", async ({
      expect,
    }) => {
      const { user, project } = await memberOf(ctx);
      const epic = await createTestEpic(ctx.alepha, project, {
        status: "in_progress",
      });
      await createTestQuest(ctx.alepha, project, {
        epicId: epic.id,
        shelvedAt: new Date().toISOString(),
      });

      const value = await resolveEpic(project, user, epic.id);

      // The divide-by-zero case. `undefined` renders as the card's no-value
      // glyph; a `0` would claim none of it is done, which is not what an
      // entirely-declined epic means.
      expect(value.ok).toBe(true);
      expect(value.value).toBeUndefined();
      expect(value.detail.denominator).toBe(0);
    });

    it("agrees with the rollup the Epics list reads", async ({ expect }) => {
      const { user, project } = await memberOf(ctx);
      const epic = await createTestEpic(ctx.alepha, project, {
        status: "in_progress",
      });
      const now = new Date().toISOString();
      await createTestQuest(ctx.alepha, project, {
        epicId: epic.id,
        completedAt: now,
      });
      await createTestQuest(ctx.alepha, project, { epicId: epic.id });

      const value = await resolveEpic(project, user, epic.id);
      // The same method, not a second count. A card that disagreed with the
      // Epics list by one is worse than no card.
      const buckets = await ctx.alepha
        .inject(EpicProgressService)
        .computeProgressOf([epic.id]);

      expect(value.detail.completed).toBe(buckets.get(epic.id)?.completed);
      expect(value.detail.total).toBe(buckets.get(epic.id)?.total);
    });

    it("keeps a completed epic's card, and says it is completed", async ({
      expect,
    }) => {
      const { user, project } = await memberOf(ctx);
      const epic = await createTestEpic(ctx.alepha, project, {
        status: "completed",
        completedAt: new Date().toISOString(),
      });
      await createTestQuest(ctx.alepha, project, {
        epicId: epic.id,
        completedAt: new Date().toISOString(),
      });

      const value = await resolveEpic(project, user, epic.id);

      // ⚠️ It stays. `completed` is terminal, so the number is settled rather
      // than stale, and repointing is the Edit item the menu already has -
      // never an auto-repoint and never a self-deletion.
      expect(value.ok).toBe(true);
      expect(value.value).toBe(100);
      expect(value.detail.status).toBe("completed");
      expect(value.detail.completedAt).toBeTruthy();
      expect(value.link?.route).toBe("projectEpic");
    });

    it("links by the per-project number, never by the row id", async ({
      expect,
    }) => {
      const { user, project } = await memberOf(ctx);
      // A number deliberately unequal to any plausible row id, so a resolver
      // that shipped the id would land on a different epic and this would go
      // red instead of silently pointing somewhere real.
      const epic = await createTestEpic(ctx.alepha, project, { number: 46 });

      const value = await resolveEpic(project, user, epic.id);

      expect(value.link?.params).toEqual({
        projectSlug: project.slug,
        epicNumber: "46",
      });
      expect(value.link?.params?.epicNumber).not.toBe(String(epic.id));
    });

    it("names the epic on its chip, not the project", async ({ expect }) => {
      const { user, project } = await memberOf(ctx);
      const epic = await createTestEpic(ctx.alepha, project, {
        title: "Lore Project Dashboard",
      });

      const value = await resolveEpic(project, user, epic.id);

      // A board full of epic cards all chipped with the project's own name
      // says nothing; the epic's title is the part that differs.
      expect(value.scopeNames).toEqual(["Lore Project Dashboard"]);
    });

    it("resolves to nothing when the project turned epics off", async ({
      expect,
    }) => {
      const project = await createTestProject(ctx.alepha, {
        capabilities: [{ key: "work", options: { epics: false } }],
      });
      await createTestMember(ctx.alepha, project, project.createdBy!);
      const epic = await createTestEpic(ctx.alepha, project);
      await createTestQuest(ctx.alepha, project, {
        epicId: epic.id,
        completedAt: new Date().toISOString(),
      });

      const value = await resolveEpic(
        project,
        token(project.createdBy!),
        epic.id,
      );

      // The option went off after the card was added. A capability is hidden
      // and never deleted, so the quests are still there - counting them
      // would put a number on the board for a surface the project no longer
      // has.
      expect(value.ok).toBe(true);
      expect(value.value).toBeUndefined();
      expect(value.detail.hidden).toBe(true);
    });
  });

  /**
   * The release card. Its arithmetic looks identical to the epic card's and
   * is NOT: `ReleaseContentService.progressOf` already counts shelved outside
   * its `total`, so the subtraction A3 ruled is a no-op here and applying it
   * twice would put a card over 100%.
   */
  describe("releaseProgress", () => {
    const resolveRelease = async (
      project: Project,
      user: UserAccountToken,
      releaseId: number,
    ) => {
      const values = await ctx.alepha
        .inject(DashboardMetricRegistry)
        .resolveForProject(
          [
            {
              id: 1,
              metric: "releaseProgress",
              scope: { kind: "release", releaseId },
              filters: {},
              size: 1,
              position: 0,
            },
          ],
          user,
          project,
        );
      return values[0]!;
    };

    it("counts the quests attached to the release", async ({ expect }) => {
      const { user, project } = await memberOf(ctx);
      const release = await ctx.repos.releases.create({
        projectId: project.id,
        number: 1,
        tag: "0.1.0",
        title: "First",
      });
      const now = new Date().toISOString();
      await createTestQuest(ctx.alepha, project, {
        releaseId: release.id,
        completedAt: now,
      });
      await createTestQuest(ctx.alepha, project, { releaseId: release.id });

      const value = await resolveRelease(project, user, release.id);

      expect(value.ok).toBe(true);
      expect(value.value).toBe(50);
      expect(value.detail.denominator).toBe(2);
    });

    it("does NOT subtract shelved twice", async ({ expect }) => {
      const { user, project } = await memberOf(ctx);
      const release = await ctx.repos.releases.create({
        projectId: project.id,
        number: 2,
        tag: "0.2.0",
        title: "Second",
      });
      const now = new Date().toISOString();
      await createTestQuest(ctx.alepha, project, {
        releaseId: release.id,
        completedAt: now,
      });
      await createTestQuest(ctx.alepha, project, { releaseId: release.id });
      await createTestQuest(ctx.alepha, project, {
        releaseId: release.id,
        shelvedAt: now,
      });

      const value = await resolveRelease(project, user, release.id);

      // ⚠️ `progressOf` already reports `total: 2` with `shelved: 1` beside
      // it, OUTSIDE the total. Subtracting again would divide by 1 and read
      // 100% on a release with a quest still open.
      expect(value.detail.total).toBe(2);
      expect(value.detail.shelved).toBe(1);
      expect(value.detail.denominator).toBe(2);
      expect(value.value).toBe(50);
    });

    it("counts an attached epic's quests, not only the loose ones", async ({
      expect,
    }) => {
      const { user, project } = await memberOf(ctx);
      const release = await ctx.repos.releases.create({
        projectId: project.id,
        number: 3,
        tag: "0.3.0",
        title: "Third",
      });
      const epic = await createTestEpic(ctx.alepha, project, {
        releaseId: release.id,
      });
      await createTestQuest(ctx.alepha, project, {
        epicId: epic.id,
        completedAt: new Date().toISOString(),
      });

      const value = await resolveRelease(project, user, release.id);

      // The reason `progressOf` exists at all: a release is mostly a set of
      // EPICS, so a direct `releaseId` count would report 0 of 0 here and
      // disagree with the changelog beside it.
      expect(value.detail.total).toBe(1);
      expect(value.value).toBe(100);
    });

    it("reads a published release's frozen columns and never recounts it", async ({
      expect,
    }) => {
      const { user, project } = await memberOf(ctx);
      const release = await ctx.repos.releases.create({
        projectId: project.id,
        number: 4,
        tag: "0.4.0",
        title: "Shipped",
        releasedAt: new Date().toISOString(),
        completed: 8,
        inProgress: 0,
        shelved: 2,
        total: 8,
      });
      // Live work that must NOT rewrite what 0.4.0 shipped.
      await createTestQuest(ctx.alepha, project, { releaseId: release.id });

      const value = await resolveRelease(project, user, release.id);

      expect(value.value).toBe(100);
      expect(value.detail.total).toBe(8);
      expect(value.detail.published).toBe(true);
      expect(value.detail.releasedAt).toBeTruthy();
    });

    it("links by the tag, and gives no link when there is none", async ({
      expect,
    }) => {
      const { user, project } = await memberOf(ctx);
      const tagged = await ctx.repos.releases.create({
        projectId: project.id,
        number: 5,
        tag: "0.5.0",
        title: "Tagged",
      });
      const untagged = await ctx.repos.releases.create({
        projectId: project.id,
        number: 6,
        title: "Untagged",
      });

      const withTag = await resolveRelease(project, user, tagged.id);
      expect(withTag.link?.route).toBe("projectRelease");
      expect(withTag.link?.params).toEqual({
        projectSlug: project.slug,
        releaseTag: "0.5.0",
      });
      // The chip reads the tag too, which is how a release is named
      // everywhere else in the app.
      expect(withTag.scopeNames).toEqual(["0.5.0"]);

      // ⚠️ `tag` is optional at the column. Better no link than
      // `/releases/undefined`.
      const withoutTag = await resolveRelease(project, user, untagged.id);
      expect(withoutTag.link).toBeUndefined();
    });

    it("resolves to nothing when the project turned releases off", async ({
      expect,
    }) => {
      const project = await createTestProject(ctx.alepha, {
        capabilities: [{ key: "work", options: { releases: false } }],
      });
      await createTestMember(ctx.alepha, project, project.createdBy!);
      const release = await ctx.repos.releases.create({
        projectId: project.id,
        number: 1,
        tag: "9.9.9",
        title: "Hidden",
      });
      await createTestQuest(ctx.alepha, project, {
        releaseId: release.id,
        completedAt: new Date().toISOString(),
      });

      const value = await resolveRelease(
        project,
        token(project.createdBy!),
        release.id,
      );

      expect(value.ok).toBe(true);
      expect(value.value).toBeUndefined();
      expect(value.detail.hidden).toBe(true);
    });
  });

  /**
   * The tag card: Thibaut's first request, as one number per tag.
   */
  describe("tagCompletion", () => {
    const resolveTag = async (
      project: Project,
      user: UserAccountToken,
      tag: string,
    ) => {
      const values = await ctx.alepha
        .inject(DashboardMetricRegistry)
        .resolveForProject(
          [
            {
              id: 1,
              metric: "tagCompletion",
              scope: { kind: "projects", projectIds: [project.id] },
              filters: { tag },
              size: 1,
              position: 0,
            },
          ],
          user,
          project,
        );
      return values[0]!;
    };

    it("counts completed over total for one tag", async ({ expect }) => {
      const { user, project } = await memberOf(ctx);
      const now = new Date().toISOString();
      await createTestQuest(ctx.alepha, project, {
        tags: ["api"],
        completedAt: now,
      });
      await createTestQuest(ctx.alepha, project, { tags: ["api"] });
      await createTestQuest(ctx.alepha, project, { tags: ["ui"] });

      const value = await resolveTag(project, user, "api");

      expect(value.ok).toBe(true);
      expect(value.value).toBe(50);
      expect(value.detail.total).toBe(2);
    });

    it("counts a quest carrying two tags in both", async ({ expect }) => {
      const { user, project } = await memberOf(ctx);
      await createTestQuest(ctx.alepha, project, {
        tags: ["api", "ui"],
        completedAt: new Date().toISOString(),
      });

      // ⚠️ The overlap the card's footer has to say out loud: these numbers
      // do not partition the project, and one card on its own would hide it.
      expect((await resolveTag(project, user, "api")).detail.total).toBe(1);
      expect((await resolveTag(project, user, "ui")).detail.total).toBe(1);
    });

    it("keeps shelved quests out of the denominator", async ({ expect }) => {
      const { user, project } = await memberOf(ctx);
      await createTestQuest(ctx.alepha, project, {
        tags: ["api"],
        completedAt: new Date().toISOString(),
      });
      await createTestQuest(ctx.alepha, project, {
        tags: ["api"],
        shelvedAt: new Date().toISOString(),
      });

      const value = await resolveTag(project, user, "api");

      // Declined work leaves both the numerator and the denominator, the same
      // `inScope` rule every Reports aggregate applies.
      expect(value.detail.total).toBe(1);
      expect(value.value).toBe(100);
    });

    it("keeps an open quest inside a draft epic out, and a completed one in", async ({
      expect,
    }) => {
      const { user, project } = await memberOf(ctx);
      const draft = await createTestEpic(ctx.alepha, project, {
        status: "draft",
      });
      await createTestQuest(ctx.alepha, project, {
        tags: ["api"],
        epicId: draft.id,
      });
      await createTestQuest(ctx.alepha, project, {
        tags: ["api"],
        epicId: draft.id,
        completedAt: new Date().toISOString(),
      });

      const value = await resolveTag(project, user, "api");

      // ⚠️ The completed quest is EXEMPT from the backlog gate, exactly as
      // `ProjectReportsController.questInScope` exempts it: a draft epic can
      // hold completed quests, and gating finished work
      // would retroactively erase it.
      expect(value.detail.total).toBe(1);
      expect(value.detail.completed).toBe(1);
    });

    it("agrees with the fold Reports uses", async ({ expect }) => {
      const { user, project } = await memberOf(ctx);
      await createTestQuest(ctx.alepha, project, {
        tags: ["api"],
        completedAt: new Date().toISOString(),
      });
      await createTestQuest(ctx.alepha, project, { tags: ["api"] });

      const value = await resolveTag(project, user, "api");
      const service = ctx.alepha.inject(QuestTagTallyService);
      const counts = service
        .tally(await service.rowsFor([project.id]))
        .get("api");

      // One tally, two readers. A second copy is the silent disagreement the
      // service exists to prevent.
      expect(value.detail.completed).toBe(counts?.completed);
      expect(value.detail.remaining).toBe(counts?.remaining);
    });

    it("shows no number for a tag nothing carries", async ({ expect }) => {
      const { user, project } = await memberOf(ctx);
      await createTestQuest(ctx.alepha, project, { tags: ["api"] });

      const value = await resolveTag(project, user, "typo");

      // Not 0%. "None of it is done" and "there is none of it" are different
      // facts, and only one of them is about progress.
      expect(value.ok).toBe(true);
      expect(value.value).toBeUndefined();
      expect(value.detail.total).toBe(0);
    });

    it("links to the quest list filtered by tag and to the open half", async ({
      expect,
    }) => {
      const { user, project } = await memberOf(ctx);
      await createTestQuest(ctx.alepha, project, { tags: ["api"] });

      const value = await resolveTag(project, user, "api");

      expect(value.link?.route).toBe("projectQuests");
      expect(value.link?.query).toEqual({
        tag: "api",
        status: "todo,in_progress",
      });
    });
  });

  describe("untriagedFeedback", () => {
    it("counts pending items and ages the oldest one", async ({ expect }) => {
      const { user, project } = await memberOf(ctx);
      const threeDaysAgo = new Date(
        ctx.dateTime.nowMillis() - 3 * 24 * 60 * 60 * 1000,
      ).toISOString();

      await ctx.repos.feedback.create({
        projectId: project.id,
        shortId: 1,
        title: "old one",
        description: "",
        status: "pending",
        createdAt: threeDaysAgo,
      });
      await ctx.repos.feedback.create({
        projectId: project.id,
        shortId: 2,
        title: "fresh",
        description: "",
        status: "pending",
      });
      await ctx.repos.feedback.create({
        projectId: project.id,
        shortId: 3,
        title: "already triaged",
        description: "",
        status: "accepted",
      });

      await only(ctx, user, [
        { metric: "untriagedFeedback", scope: { kind: "all" } },
      ]);
      const { values } = await ctx.controller.resolveCards(
        { body: {} },
        { user },
      );

      expect(values[0]).toMatchObject({
        ok: true,
        value: 2,
        detail: { oldestWaitingDays: 3 },
      });
      expect(values[0]?.link?.route).toBe("projectFeedback");
    });

    it("ages the oldest item off the clock, not off a captured timestamp", async ({
      expect,
    }) => {
      const { user, project } = await memberOf(ctx);
      await ctx.repos.feedback.create({
        projectId: project.id,
        shortId: 1,
        title: "waiting",
        description: "",
        status: "pending",
      });
      await only(ctx, user, [
        { metric: "untriagedFeedback", scope: { kind: "all" } },
      ]);

      const now = await ctx.controller.resolveCards({ body: {} }, { user });
      expect(now.values[0]?.detail).toMatchObject({ oldestWaitingDays: 0 });

      // `DateTimeProvider`, never `Date.now()` — this is what that buys.
      // Assert the end state rather than any call count: `travel()` also
      // releases every `$job` cron in the container.
      await ctx.dateTime.travel(5, "days");

      const later = await ctx.controller.resolveCards({ body: {} }, { user });
      expect(later.values[0]?.detail).toMatchObject({ oldestWaitingDays: 5 });
    });

    it("does not accept an app scope, since nothing can attribute feedback to one", async ({
      expect,
    }) => {
      const { user, project } = await memberOf(ctx);
      const app = await createSigil(ctx, project, "web", ["feedback"]);

      await expect(
        ctx.controller.addCard(
          {
            body: {
              metric: "untriagedFeedback",
              scope: { kind: "apps", sigilIds: [app.id] },
            },
          },
          { user },
        ),
      ).rejects.toThrow(/does not accept a apps scope/);
    });
  });

  describe("openBlights", () => {
    it("counts a bug in two selected apps once, with the footer figures", async ({
      expect,
    }) => {
      const { user, project } = await memberOf(ctx);
      const web = await createSigil(ctx, project, "web", ["blights"]);
      const api = await createSigil(ctx, project, "api", ["blights"]);
      const stamp = new Date(ctx.dateTime.nowMillis()).toISOString();

      for (const sigil of [web, api]) {
        await ctx.repos.errorGroups.create({
          sigilId: sigil.id,
          fingerprint: "fp-shared",
          name: "TypeError",
          message: "boom",
          stackSample: "",
          sourceUrl: "",
          firstSeenAt: stamp,
          lastSeenAt: stamp,
          count: 6,
        });
      }
      await ctx.repos.blights.create({
        projectId: project.id,
        sigilId: api.id,
        fingerprint: "fp-shared",
        name: "TypeError",
        message: "boom",
        firstSeenAt: stamp,
        lastSeenAt: stamp,
        count: 12,
        status: "open",
      });

      await only(ctx, user, [
        {
          metric: "openBlights",
          scope: { kind: "apps", sigilIds: [web.id, api.id] },
        },
      ]);
      const { values } = await ctx.controller.resolveCards(
        { body: {} },
        { user },
      );

      expect(values[0]).toMatchObject({
        ok: true,
        value: 1,
        detail: { occurrences: 12, apps: 2 },
      });
      expect(values[0]?.scopeNames).toEqual(["web", "api"]);
      expect(values[0]?.link).toEqual({
        route: "projectBlights",
        params: { projectSlug: project.slug },
      });
    });

    it("degrades rather than zeroing when a selected app is deleted", async ({
      expect,
    }) => {
      const { user, project } = await memberOf(ctx);
      const web = await createSigil(ctx, project, "web", ["blights"]);
      const stamp = new Date(ctx.dateTime.nowMillis()).toISOString();
      await ctx.repos.blights.create({
        projectId: project.id,
        sigilId: web.id,
        fingerprint: "fp-live",
        name: "TypeError",
        message: "boom",
        firstSeenAt: stamp,
        lastSeenAt: stamp,
        count: 3,
        status: "open",
      });

      await only(ctx, user, [
        { metric: "openBlights", scope: { kind: "apps", sigilIds: [web.id] } },
      ]);
      await ctx.repos.sigils.deleteMany({ id: { eq: web.id } });

      const { values } = await ctx.controller.resolveCards(
        { body: {} },
        { user },
      );

      // Blights outlive their apps: `blights.sigilId` is ON DELETE SET NULL
      // and the row survives. A zero here would read as "nothing is wrong",
      // which is exactly what an inbox full of open crashes is not.
      expect(values[0]).toMatchObject({ ok: false });
      expect(values[0]?.value).toBeUndefined();
    });
  });

  describe("uniqueVisitors", () => {
    it("reports yesterday against the day before", async ({ expect }) => {
      const { user, project } = await memberOf(ctx);
      const docs = await createSigil(ctx, project, "docs", ["beacon"]);

      for (const visitorHash of ["a", "b", "c", "d", "e"]) {
        await ctx.repos.uniques.create({
          sigilId: docs.id,
          day: dayUtc(ctx, 1),
          visitorHash,
        });
      }
      for (const visitorHash of ["p", "q", "r", "s"]) {
        await ctx.repos.uniques.create({
          sigilId: docs.id,
          day: dayUtc(ctx, 2),
          visitorHash,
        });
      }
      // Today is deliberately busy: a tile that counted today-so-far would
      // read as a collapse every morning.
      await ctx.repos.uniques.create({
        sigilId: docs.id,
        day: dayUtc(ctx, 0),
        visitorHash: "today",
      });

      await only(ctx, user, [
        {
          metric: "uniqueVisitors",
          scope: { kind: "apps", sigilIds: [docs.id] },
        },
      ]);
      const { values } = await ctx.controller.resolveCards(
        { body: {} },
        { user },
      );

      expect(values[0]).toMatchObject({
        ok: true,
        value: 5,
        delta: 25,
        detail: { day: dayUtc(ctx, 1), previous: 4 },
      });
      expect(values[0]?.link).toEqual({
        route: "appAnalytics",
        params: { projectSlug: project.slug, appName: "docs" },
      });
    });

    it("says 'no beacon app' rather than zero when nothing reports", async ({
      expect,
    }) => {
      const { user, project } = await memberOf(ctx);
      await createSigil(ctx, project, "api", ["blights"]);

      await only(ctx, user, [
        {
          metric: "uniqueVisitors",
          scope: { kind: "projects", projectIds: [project.id] },
        },
      ]);
      const { values } = await ctx.controller.resolveCards(
        { body: {} },
        { user },
      );

      // "No app is reporting" and "nobody visited" are different facts, and
      // only one of them is about traffic.
      expect(values[0]?.value).toBeUndefined();
      expect(values[0]?.detail).toEqual({ noBeaconApp: true });
      expect(values[0]?.link).toBeUndefined();
    });
  });

  /**
   * The two scope kinds `dashboardScopeSchema` reserved in epic #E4 and no
   * metric ever accepted, plus the project board's own entry point.
   *
   * Driven through `DashboardScopeService` rather than through a controller,
   * because that class IS the security boundary: it is where "belongs to this
   * project" is decided, and the two answers that matter — the row, or a 404 —
   * are its own.
   */
  describe("epic and release scopes", () => {
    const scopeService = () => ctx.alepha.inject(DashboardScopeService);

    it("resolves an epic of a project the caller belongs to", async ({
      expect,
    }) => {
      const { user, project } = await memberOf(ctx);
      const epic = await createTestEpic(ctx.alepha, project, {
        title: "Dashboard",
        number: 46,
      });

      const resolved = await scopeService().resolve(
        { kind: "epic", epicId: epic.id },
        user,
      );

      expect(resolved.epic?.id).toBe(epic.id);
      // The per-project NUMBER is what `projectEpic` addresses, and it is
      // reachable only because the row came back rather than the id.
      expect(resolved.epic?.number).toBe(46);
      expect(resolved.projectIds).toEqual([project.id]);
    });

    it("answers 404 for an epic in a project the caller has nothing to do with", async ({
      expect,
    }) => {
      const { user } = await memberOf(ctx);
      const stranger = await createTestProject(ctx.alepha);
      const epic = await createTestEpic(ctx.alepha, stranger);

      // ⚠️ 404, never an empty answer. "No such epic here" is true whether the
      // epic does not exist or belongs to somebody else's project, and
      // distinguishing them would leak the second.
      await expect(
        scopeService().resolve({ kind: "epic", epicId: epic.id }, user),
      ).rejects.toThrow(/Epic not found/);
    });

    it("answers 404 for an epic id that exists nowhere", async ({ expect }) => {
      const { user } = await memberOf(ctx);

      await expect(
        scopeService().resolve({ kind: "epic", epicId: 987654 }, user),
      ).rejects.toThrow(/Epic not found/);
    });

    it("resolves a release, and refuses one from another project", async ({
      expect,
    }) => {
      const { user, project } = await memberOf(ctx);
      const mine = await ctx.repos.releases.create({
        projectId: project.id,
        number: 1,
        tag: "0.1.0",
        title: "First",
      });
      const stranger = await createTestProject(ctx.alepha);
      const theirs = await ctx.repos.releases.create({
        projectId: stranger.id,
        number: 1,
        tag: "9.9.9",
        title: "Theirs",
      });

      const resolved = await scopeService().resolve(
        { kind: "release", releaseId: mine.id },
        user,
      );
      // The TAG, which is what `/alepha/releases/0.1.0` is built from.
      expect(resolved.release?.tag).toBe("0.1.0");

      await expect(
        scopeService().resolve({ kind: "release", releaseId: theirs.id }, user),
      ).rejects.toThrow(/Release not found/);
    });

    it("still refuses a malformed scope before it reaches a table", async ({
      expect,
    }) => {
      const { user } = await memberOf(ctx);

      // `assertWellFormed` already covered these two kinds; what was missing
      // was only the resolution half, and adding it must not have loosened
      // the structural check on the way past.
      await expect(
        scopeService().resolve({ kind: "epic" } as DashboardScope, user),
      ).rejects.toThrow(/requires epicId/);
      await expect(
        scopeService().resolve(
          { kind: "release", releaseId: 1, epicId: 2 } as DashboardScope,
          user,
        ),
      ).rejects.toThrow(/must not carry epicId/);
    });
  });

  /**
   * The project board's own entry point: the route has already proved
   * membership, so the registry is handed that one project instead of running
   * an account-wide users-to-projects join for a board that has a gate.
   */
  describe("the project board's resolve path", () => {
    it("refuses a home-only metric, whatever its scope kind", async ({
      expect,
    }) => {
      const { user, project } = await memberOf(ctx);
      const registry = ctx.alepha.inject(DashboardMetricRegistry);
      const sigil = await createSigil(ctx, project, "app/production", [
        "beacon",
      ]);

      // `uniqueVisitors` declares `boards: ["home"]` and accepts an `apps`
      // scope, so only the board argument reaching `accepts()` can refuse
      // this. Without it the card would resolve and put a cross-project
      // metric on a project's board.
      const values = await registry.resolveForProject(
        [
          {
            id: 1,
            metric: "uniqueVisitors",
            scope: { kind: "apps", sigilIds: [sigil.id] },
            filters: { period: "yesterday" },
            size: 1,
            position: 0,
          },
        ],
        user,
        project,
      );

      expect(values[0]?.ok).toBe(false);
    });

    it("drops an epic whose project turned the capability off", async ({
      expect,
    }) => {
      const project = await createTestProject(ctx.alepha, {
        capabilities: [{ key: "knowledge" }],
      });
      await createTestMember(ctx.alepha, project, project.createdBy!);
      const epic = await createTestEpic(ctx.alepha, project);

      const security = ctx.alepha.inject(ProjectSecurityService);
      const capabilities = await security.capabilityRowsForProjects([
        project.id,
      ]);

      const narrowed = ctx.registry.testNarrow(
        {
          key: "epicProgress",
          boards: ["project"],
          group: "epics",
          labelKey: "x",
          hintKey: "x",
          icon: "layers",
          presentation: "progress",
          scopeKinds: ["epic"],
          filters: z.object({}),
          needs: { capability: "work", option: "epics" },
          link: () => undefined,
        },
        {
          projectIds: [project.id],
          projects: [project],
          sigils: [],
          epic,
        },
        capabilities,
      );

      // ⚠️ The epic goes WITH its project. A capability is hidden and never
      // deleted, so the rows are still there — counting them would put a
      // number on the board for a surface the project no longer has.
      expect(narrowed.projects).toEqual([]);
      expect(narrowed.epic).toBeUndefined();
    });
  });

  describe("degradation", () => {
    it("costs a tile, not the page, when a card's scope disappears", async ({
      expect,
    }) => {
      const { user, project } = await memberOf(ctx);
      const doomed = await createTestProject(ctx.alepha, {
        createdBy: project.createdBy,
      });
      await createTestMember(ctx.alepha, doomed, user.id);
      await createTestQuest(ctx.alepha, project);

      const [goodId, badId] = await only(ctx, user, [
        {
          metric: "activeQuests",
          scope: { kind: "projects", projectIds: [project.id] },
        },
        {
          metric: "activeQuests",
          scope: { kind: "projects", projectIds: [doomed.id] },
        },
      ]);

      // The card was valid when written; access went away afterwards.
      await ctx.alepha.inject(TestEntityRepositories).members.deleteMany({
        projectId: { eq: doomed.id },
      });

      const { values } = await ctx.controller.resolveCards(
        { body: {} },
        { user },
      );

      expect(values.find((v) => v.cardId === goodId)).toMatchObject({
        ok: true,
        value: 1,
      });
      expect(values.find((v) => v.cardId === badId)).toMatchObject({
        ok: false,
      });
    });

    it("degrades a card whose metric this build does not know", async ({
      expect,
    }) => {
      const { user } = await memberOf(ctx);
      const [id] = await only(ctx, user, [
        { metric: "activeQuests", scope: { kind: "all" } },
      ]);
      // A card written by a newer deploy, or a metric since removed.
      await ctx.repos.cards.updateOne(
        { id: { eq: id } },
        { metric: "somethingFromTheFuture" },
      );

      const { values } = await ctx.controller.resolveCards(
        { body: {} },
        { user },
      );

      expect(values).toHaveLength(1);
      expect(values[0]).toMatchObject({ cardId: id, ok: false });
    });

    it("degrades a card whose metric no longer accepts its scope kind", async ({
      expect,
    }) => {
      const { user, project } = await memberOf(ctx);
      const app = await createSigil(ctx, project, "web", ["blights"]);
      const [id] = await only(ctx, user, [
        {
          metric: "openBlights",
          scope: { kind: "apps", sigilIds: [app.id] },
        },
      ]);
      // Feedback accepts `projects` / `all` only — this is the shape a card
      // takes if a metric ever narrows its kinds after cards were written.
      await ctx.repos.cards.updateOne(
        { id: { eq: id } },
        { metric: "untriagedFeedback" },
      );

      const { values } = await ctx.controller.resolveCards(
        { body: {} },
        { user },
      );

      expect(values[0]).toMatchObject({ cardId: id, ok: false });
    });
  });

  describe("the endpoint", () => {
    it("answers the whole board in one call, in layout order", async ({
      expect,
    }) => {
      const { user } = await memberOf(ctx);
      const { cards } = await ctx.controller.listCards({}, { user });

      const res = await ctx.controller.resolveCards({ body: {} }, { user });

      expect(res.values.map((v) => v.cardId)).toEqual(
        cards.map((card) => card.id),
      );
      expect(res.refreshedAt).toBeTruthy();
    });

    it("narrows to the cards asked for", async ({ expect }) => {
      const { user } = await memberOf(ctx);
      const { cards } = await ctx.controller.listCards({}, { user });

      const res = await ctx.controller.resolveCards(
        { body: { cardIds: [cards[1]!.id] } },
        { user },
      );

      expect(res.values.map((v) => v.cardId)).toEqual([cards[1]!.id]);
    });

    it("never resolves another user's card, even by id", async ({ expect }) => {
      const mine = await memberOf(ctx);
      const theirs = await memberOf(ctx);
      const { cards } = await ctx.controller.listCards({}, { user: mine.user });

      const res = await ctx.controller.resolveCards(
        { body: { cardIds: [cards[0]!.id] } },
        { user: theirs.user },
      );

      expect(res.values).toEqual([]);
    });
  });

  /**
   * The number `resolveAll` exists for.
   *
   * `DashboardMetricRegistry` groups cards by metric precisely so a
   * resolver can answer for many at once — and every resolver used to
   * implement that seam as a sequential loop, so the grouping bought
   * nothing at all and the cost grew with the number of tiles a reader
   * pinned. Nothing else in the pipeline measures that: a looping resolver
   * and a batched one return identical values.
   */
  describe("query count", () => {
    /**
     * Three projects the caller belongs to, so a `projects` scope and an
     * `all` scope are genuinely different narrowings of one union.
     */
    const threeProjects = async () => {
      const mine = await memberOf(ctx);
      const second = await createTestProject(ctx.alepha, {
        createdBy: mine.project.createdBy,
      });
      const third = await createTestProject(ctx.alepha, {
        createdBy: mine.project.createdBy,
      });
      await createTestMember(ctx.alepha, second, mine.user.id);
      await createTestMember(ctx.alepha, third, mine.user.id);
      return { ...mine, second, third };
    };

    it("reads each table once per metric, not once per card", async ({
      expect,
    }) => {
      const { user, project, second, third } = await threeProjects();
      await createTestQuest(ctx.alepha, project);
      await createTestQuest(ctx.alepha, second);
      await ctx.repos.feedback.create({
        projectId: project.id,
        shortId: 1,
        title: "one",
        description: "",
        status: "pending",
      });

      const measure = async (
        cards: Array<{
          metric: string;
          scope: DashboardScope;
          filters?: Record<string, unknown>;
        }>,
      ) => {
        await only(ctx, user, cards);
        ctx.counter.reset();
        await ctx.controller.resolveCards({ body: {} }, { user });
        return {
          quests: ctx.counter.of("quests"),
          feedback: ctx.counter.of("feedback"),
          epics: ctx.counter.of("epics"),
        };
      };

      const one = await measure([
        { metric: "activeQuests", scope: { kind: "all" } },
        { metric: "untriagedFeedback", scope: { kind: "all" } },
      ]);

      const many = await measure([
        { metric: "activeQuests", scope: { kind: "all" } },
        {
          metric: "activeQuests",
          scope: { kind: "projects", projectIds: [project.id] },
        },
        {
          metric: "activeQuests",
          scope: { kind: "projects", projectIds: [second.id, third.id] },
        },
        { metric: "untriagedFeedback", scope: { kind: "all" } },
        {
          metric: "untriagedFeedback",
          scope: { kind: "projects", projectIds: [project.id] },
          filters: { status: "all" },
        },
      ]);

      // Two cards or five, the same three statements: one `quests`, one
      // `feedback`, and the one `epics` read the backlog gate needs.
      //
      // Exact, never `toBeLessThan`: an upper bound stays green if a later
      // change stops reading anything at all.
      expect({ one, many }).toEqual({
        one: { quests: 1, feedback: 1, epics: 1 },
        many: { quests: 1, feedback: 1, epics: 1 },
      });
    });

    it("still narrows each card to its own scope off the shared read", async ({
      expect,
    }) => {
      const { user, project, second, third } = await threeProjects();
      await createTestQuest(ctx.alepha, project);
      await createTestQuest(ctx.alepha, second);
      await createTestQuest(ctx.alepha, second);
      await createTestQuest(ctx.alepha, third);

      const ids = await only(ctx, user, [
        { metric: "activeQuests", scope: { kind: "all" } },
        {
          metric: "activeQuests",
          scope: { kind: "projects", projectIds: [project.id] },
        },
        {
          metric: "activeQuests",
          scope: { kind: "projects", projectIds: [second.id, third.id] },
        },
      ]);

      const { values } = await ctx.controller.resolveCards(
        { body: {} },
        { user },
      );
      const valueOf = (id: number) =>
        values.find((v) => v.cardId === id)?.value;

      // The partition, which is where a batched resolver goes wrong: one
      // read for the union, three different answers out of it. A resolver
      // that forgot to intersect would report 4 three times.
      expect(ids.map(valueOf)).toEqual([4, 1, 3]);
    });

    it("applies each project's own backlog gate through the shared read", async ({
      expect,
    }) => {
      const { user, project, second } = await threeProjects();
      const plannedHere = await createTestEpic(ctx.alepha, project, {
        status: "draft",
      });
      const activeThere = await createTestEpic(ctx.alepha, second, {
        status: "in_progress",
      });
      await createTestQuest(ctx.alepha, project, { epicId: plannedHere.id });
      await createTestQuest(ctx.alepha, project);
      await createTestQuest(ctx.alepha, second, { epicId: activeThere.id });

      const ids = await only(ctx, user, [
        {
          metric: "activeQuests",
          scope: { kind: "projects", projectIds: [project.id] },
        },
        {
          metric: "activeQuests",
          scope: { kind: "projects", projectIds: [second.id] },
        },
      ]);

      const { values } = await ctx.controller.resolveCards(
        { body: {} },
        { user },
      );
      const valueOf = (id: number) =>
        values.find((v) => v.cardId === id)?.value;

      // The claim the batched read rests on: the gate computed over the
      // UNION is the same gate each project would have got on its own,
      // because an epic belongs to exactly one project. The first card
      // loses its draft-epic quest, the second keeps its active-epic one,
      // and neither is affected by the other's epics.
      expect(ids.map(valueOf)).toEqual([1, 1]);
    });

    it("keeps the feedback status filter working now that it is in memory", async ({
      expect,
    }) => {
      const { user, project } = await threeProjects();
      await ctx.repos.feedback.create({
        projectId: project.id,
        shortId: 1,
        title: "waiting",
        description: "",
        status: "pending",
      });
      await ctx.repos.feedback.create({
        projectId: project.id,
        shortId: 2,
        title: "handled",
        description: "",
        status: "accepted",
      });

      const ids = await only(ctx, user, [
        { metric: "untriagedFeedback", scope: { kind: "all" } },
        {
          metric: "untriagedFeedback",
          scope: { kind: "all" },
          filters: { status: "all" },
        },
      ]);

      const { values } = await ctx.controller.resolveCards(
        { body: {} },
        { user },
      );
      const valueOf = (id: number) =>
        values.find((v) => v.cardId === id)?.value;

      // `status` moved out of SQL so two cards asking for different
      // statuses could share one read. Both readings still have to come
      // out right, and they are the reason it could not stay in the
      // statement.
      expect(ids.map(valueOf)).toEqual([1, 2]);
    });
  });
});
