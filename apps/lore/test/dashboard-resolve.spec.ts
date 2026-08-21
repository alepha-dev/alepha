import { Alepha } from "alepha";
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
import { sigilErrorGroups } from "@/api/entities/sigilErrorGroups.ts";
import { type Sigil, sigils } from "@/api/entities/sigils.ts";
import { sigilUniquesDaily } from "@/api/entities/sigilUniquesDaily.ts";
import { LoreApi } from "@/api/index.ts";
import type { DashboardScope } from "@/api/schemas/dashboardScopeSchema.ts";
import {
  createTestEpic,
  createTestMember,
  createTestProject,
  createTestQuest,
  TestEntityRepositories,
} from "./fixtures/entities.ts";

class ResolveTestRepositories {
  sigils = $repository(sigils);
  blights = $repository(blights);
  errorGroups = $repository(sigilErrorGroups);
  uniques = $repository(sigilUniquesDaily);
  feedback = $repository(feedback);
  cards = $repository(dashboardCards);
  settings = $repository(dashboardSettings);
}

interface TestContext {
  alepha: Alepha;
  controller: DashboardController;
  repos: ResolveTestRepositories;
  dateTime: DateTimeProvider;
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

  alepha.inject(TestEntityRepositories);
  const repos = alepha.inject(ResolveTestRepositories);

  await alepha.start();

  return {
    alepha,
    controller: alepha.inject(DashboardController),
    repos,
    dateTime: alepha.inject(DateTimeProvider),
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

/** Replace the seeded set with exactly the cards a test is about. */
const only = async (
  ctx: TestContext,
  user: UserAccountToken,
  cards: Array<{ metric: string; scope: DashboardScope }>,
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

/** `YYYY-MM-DD` for `daysAgo` days before the container's clock, UTC. */
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
        detail: { newCount: 2, acceptedCount: 1 },
      });
    });

    it("excludes quests inside a planned epic, exactly as the list does", async ({
      expect,
    }) => {
      const { user, project } = await memberOf(ctx);
      const planned = await createTestEpic(ctx.alepha, project, {
        status: "planned",
      });
      const active = await createTestEpic(ctx.alepha, project, {
        status: "active",
      });
      await createTestQuest(ctx.alepha, project, { epicId: planned.id });
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
      // it opens. A planned epic's quests are not in that list.
      expect(values[0]?.value).toBe(2);
    });

    it("links to status=new even though it counted new + accepted", async ({
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
        query: { status: "new" },
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
      ).rejects.toThrowError(/does not accept a apps scope/);
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
});
