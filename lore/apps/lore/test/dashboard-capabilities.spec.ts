import { Alepha } from "alepha";
import { AlephaApiUsers } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { $repository, AlephaOrm } from "alepha/orm";
import { AlephaSecurity, type UserAccountToken } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { afterEach, beforeEach, describe, it } from "vitest";

import { DashboardController } from "@/api/controllers/DashboardController.ts";
import type { Project } from "@/api/entities/projects.ts";
import { type Sigil, sigils } from "@/api/entities/sigils.ts";
import { sigilUniquesDaily } from "@/api/entities/sigilUniquesDaily.ts";
import { LoreApi } from "@/api/index.ts";
import type { CapabilityKey } from "@/api/schemas/capabilityKeySchema.ts";
import type { DashboardScope } from "@/api/schemas/dashboardScopeSchema.ts";
import { CapabilityRegistry } from "@/api/services/CapabilityRegistry.ts";
import { DashboardMetricCatalog } from "@/api/services/DashboardMetricCatalog.ts";
import {
  eligibleApps,
  eligibleProjects,
  metricUnavailableKey,
} from "@/web/app/components/dashboard/dashboardEligibility.ts";

import {
  createTestMember,
  createTestProject,
  createTestQuest,
  TestEntityRepositories,
} from "./fixtures/entities.ts";

/**
 * The home dashboard composes capabilities rather than belonging to one.
 *
 * ⚠️ **Per scope target, never per board.** A card counts across the projects
 * the reader belongs to, so the question is never "does this account do Work"
 * but "does THIS project". Both halves are asserted here: the picker offering
 * only projects that can answer, and the resolver counting only those, since
 * a UI filter alone would leave a card added before the switch moved still
 * counting rows the project now hides.
 */
class DashboardCapabilityRepositories {
  sigils = $repository(sigils);
  uniques = $repository(sigilUniquesDaily);
}

interface TestContext {
  alepha: Alepha;
  controller: DashboardController;
  repos: DashboardCapabilityRepositories;
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
  const repos = alepha.inject(DashboardCapabilityRepositories);
  await alepha.start();

  return {
    alepha,
    controller: alepha.inject(DashboardController),
    repos,
  };
};

const token = (id: string): UserAccountToken => ({ id, roles: ["user"] });

const memberOf = async (
  ctx: TestContext,
  capabilities: Array<{
    key: CapabilityKey;
    options?: Record<string, boolean>;
  }>,
): Promise<{ user: UserAccountToken; project: Project }> => {
  const project = await createTestProject(ctx.alepha, { capabilities });
  await createTestMember(ctx.alepha, project, project.createdBy!);
  return { user: token(project.createdBy!), project };
};

/**
 * Replace the seeded set with exactly the cards a test is about.
 */
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
  kinds: string[],
): Promise<Sigil> => {
  tokenSeq += 1;
  return ctx.repos.sigils.create({
    projectId: project.id,
    name: `app-${tokenSeq}/production`,
    tokenHash: `cap-hash-${tokenSeq}`,
    tokenPrefix: `sg_c${tokenSeq}`,
    kinds,
  });
};

const aProject = (
  id: number,
  capabilities: Array<{
    key: CapabilityKey;
    options?: Record<string, boolean>;
  }>,
) => ({
  id,
  capabilities: capabilities.map((it) => ({
    key: it.key,
    enabledAt: "2026-09-06T00:00:00.000Z",
    options: it.options ?? {},
  })),
});

describe("dashboard cards and capabilities", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setup();
  });

  afterEach(async () => {
    await ctx.alepha.stop();
  });

  describe("the two registries agree", () => {
    it("every metric's needs names the capability that claims it", ({
      expect,
    }) => {
      const catalog = ctx.alepha.inject(DashboardMetricCatalog);
      const registry = ctx.alepha.inject(CapabilityRegistry);

      for (const metric of catalog.all()) {
        // The whole point of pinning them: `CapabilityRegistry.dashboardCards`
        // is the epic's single declaration of what a capability owns, and the
        // catalogue's `needs` is what the pickers read. Two lists that only
        // meet at review are two lists that drift.
        expect(metric.needs?.capability).toBe(
          registry.ownerOfDashboardCard(metric.key),
        );
      }
    });

    it("every key a capability claims exists in the catalogue", ({
      expect,
    }) => {
      const catalog = ctx.alepha.inject(DashboardMetricCatalog);
      const registry = ctx.alepha.inject(CapabilityRegistry);

      for (const capability of registry.all()) {
        for (const key of capability.dashboardCards) {
          expect(catalog.find(key)).toBeDefined();
        }
      }
    });
  });

  describe("what the Add-card panel offers", () => {
    it("withholds a quest card from a Knowledge-only project", ({ expect }) => {
      const catalog = ctx.alepha.inject(DashboardMetricCatalog);
      const activeQuests = catalog.get("activeQuests");
      const projects = [aProject(1, [{ key: "knowledge" }])];

      expect(eligibleProjects(activeQuests, projects)).toEqual([]);
      expect(metricUnavailableKey(activeQuests, projects, [])).toBe(
        "dashboard.catalogue.noProjects",
      );
    });

    it("offers it as soon as one project does Work", ({ expect }) => {
      const catalog = ctx.alepha.inject(DashboardMetricCatalog);
      const activeQuests = catalog.get("activeQuests");
      const projects = [
        aProject(1, [{ key: "knowledge" }]),
        aProject(2, [{ key: "work" }]),
      ];

      // The `all` card is offered because ONE project can answer it, and the
      // picker lists only that one. Hiding the metric outright would be the
      // per-board answer this is deliberately not.
      expect(
        eligibleProjects(activeQuests, projects).map((it) => it.id),
      ).toEqual([2]);
      expect(metricUnavailableKey(activeQuests, projects, [])).toBeUndefined();
    });

    it("needs the option, not just the capability, for blights", ({
      expect,
    }) => {
      const catalog = ctx.alepha.inject(DashboardMetricCatalog);
      const openBlights = catalog.get("openBlights");

      expect(
        eligibleProjects(openBlights, [
          aProject(1, [{ key: "apps", options: { track: false } }]),
        ]),
      ).toEqual([]);
      expect(
        eligibleProjects(openBlights, [
          aProject(1, [{ key: "apps", options: { track: true } }]),
        ]).map((it) => it.id),
      ).toEqual([1]);
    });

    it("filters apps by their own project, and by beacon", ({ expect }) => {
      const catalog = ctx.alepha.inject(DashboardMetricCatalog);
      const projects = [
        aProject(1, [{ key: "apps", options: { track: true } }]),
        aProject(2, [{ key: "knowledge" }]),
      ];
      const apps = [
        {
          id: "a",
          name: "club/production",
          projectId: 1,
          projectTitle: "One",
          beacon: true,
        },
        {
          id: "b",
          name: "club/staging",
          projectId: 1,
          projectTitle: "One",
          beacon: false,
        },
        {
          id: "c",
          name: "other/production",
          projectId: 2,
          projectTitle: "Two",
          beacon: true,
        },
      ];

      // Blights: `beacon` is irrelevant, the project is not.
      expect(
        eligibleApps(catalog.get("openBlights"), apps, projects).map(
          (it) => it.id,
        ),
      ).toEqual(["a", "b"]);

      // Visitors: both conditions, and they are genuinely independent - `b`
      // is dropped for the app's own kinds, `c` for its project's capability.
      expect(
        eligibleApps(catalog.get("uniqueVisitors"), apps, projects).map(
          (it) => it.id,
        ),
      ).toEqual(["a"]);
    });
  });

  describe("what the resolver counts", () => {
    it("counts nothing for a project that turned Work off", async ({
      expect,
    }) => {
      const { user, project } = await memberOf(ctx, [{ key: "knowledge" }]);
      // The quests are still there - disabling HIDES. A card added while Work
      // was on would otherwise keep putting their count on the landing page.
      await createTestQuest(ctx.alepha, project, { title: "one" });
      await createTestQuest(ctx.alepha, project, { title: "two" });

      const [cardId] = await only(ctx, user, [
        { metric: "activeQuests", scope: { kind: "all" } },
      ]);

      const resolved = await ctx.controller.resolveCards(
        { body: {} },
        { user },
      );
      const value = resolved.values.find((it) => it.cardId === cardId);

      // Zero, not `ok: false`: the project genuinely has no Work surface, and
      // "unreadable" is reserved for a scope that cannot be proven at all.
      expect(value?.ok).toBe(true);
      expect(value?.value).toBe(0);
    });

    it("counts the projects that still have it, on an all-scoped card", async ({
      expect,
    }) => {
      const { user, project } = await memberOf(ctx, [{ key: "work" }]);
      await createTestQuest(ctx.alepha, project, { title: "counted" });

      const other = await createTestProject(ctx.alepha, {
        capabilities: [{ key: "knowledge" }],
        createdBy: project.createdBy,
      });
      await createTestMember(ctx.alepha, other, project.createdBy!);
      await createTestQuest(ctx.alepha, other, { title: "hidden" });

      const [cardId] = await only(ctx, user, [
        { metric: "activeQuests", scope: { kind: "all" } },
      ]);

      const resolved = await ctx.controller.resolveCards(
        { body: {} },
        { user },
      );
      const value = resolved.values.find((it) => it.cardId === cardId);

      // One project of two dropping out narrows the number; it must never
      // fail the whole card, which is what an `all` scope would mean for
      // anybody with a mixed set of projects.
      expect(value?.ok).toBe(true);
      expect(value?.value).toBe(1);
    });

    it("drops an app whose project lost the tracking option", async ({
      expect,
    }) => {
      const { user, project } = await memberOf(ctx, [
        { key: "apps", options: { track: false } },
      ]);
      const sigil = await createSigil(ctx, project, ["beacon"]);
      await ctx.repos.uniques.create({
        sigilId: sigil.id,
        day: new Date().toISOString().slice(0, 10),
        visitorHash: "abc",
        traffic: "human",
      });

      const [cardId] = await only(ctx, user, [
        {
          metric: "uniqueVisitors",
          scope: { kind: "apps", sigilIds: [sigil.id] },
        },
      ]);

      const resolved = await ctx.controller.resolveCards(
        { body: {} },
        { user },
      );
      const value = resolved.values.find((it) => it.cardId === cardId);

      // ⚠️ Not zero, and that is `UniqueVisitorsMetric`'s own rule rather
      // than anything this change added: "no app is reporting" and "nobody
      // visited" are different facts and only one of them is about traffic.
      // The narrowing empties the scope, the metric's existing branch takes
      // it from there, and the footer's "no app here reports page views" is
      // exactly true of a project that turned tracking off.
      expect(value?.ok).toBe(true);
      expect(value?.value).toBeUndefined();
      expect(value?.detail?.noBeaconApp).toBe(true);
    });
  });
});
