import { Alepha } from "alepha";
import { AlephaApiUsers } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { $repository, AlephaOrm } from "alepha/orm";
import type { UserAccountToken } from "alepha/security";
import { AlephaSecurity } from "alepha/security";
import {
  AlephaServer,
  BadRequestError,
  ForbiddenError,
  NotFoundError,
} from "alepha/server";
import { afterEach, beforeEach, describe, it } from "vitest";

import {
  createTestProject,
  TestEntityRepositories,
} from "../../../test/fixtures/entities.ts";
import { LoreAnalytics } from "../entities/loreAnalytics.ts";
import { type Sigil, sigils } from "../entities/sigils.ts";
import { LoreApi } from "../index.ts";
import { SigilAnalyticsController } from "./SigilAnalyticsController.ts";

/**
 * `sigils` is not part of `TestEntityRepositories`, so this spec registers it
 * itself — pre-`start()`, like everything else the schema sync has to see.
 */
class SigilRepositories {
  sigils = $repository(sigils);
}

interface TestContext {
  alepha: Alepha;
  controller: SigilAnalyticsController;
  datasets: LoreAnalytics;
  repos: SigilRepositories;
}

/**
 * Pinned, like every other lore spec: the ROOT vitest config sets
 * `DATABASE_URL` to a Postgres URL, which this app's SQLite provider rejects.
 */
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
  const repos = alepha.inject(SigilRepositories);

  await alepha.start();

  return {
    alepha,
    controller: alepha.inject(SigilAnalyticsController),
    datasets: alepha.inject(LoreAnalytics),
    repos,
  };
};

const ownerToken = (project: { createdBy: string }): UserAccountToken => ({
  id: project.createdBy,
  roles: ["user"],
});

let sigilSeq = 0;
const createTestSigil = async (
  ctx: TestContext,
  projectId: number,
  overrides: Partial<Sigil> = {},
): Promise<Sigil> => {
  sigilSeq += 1;
  return ctx.repos.sigils.create({
    projectId,
    name: `app-${sigilSeq}`,
    tokenHash: `hash-${sigilSeq}`,
    tokenPrefix: "sg_test_",
    kinds: ["beacon"],
    ...overrides,
  });
};

/**
 * The per-app query explorer's read surface.
 *
 * Every test here is about the scope rather than about the query language,
 * which `AdminAnalyticsService.spec.ts` already covers. What this controller
 * adds is the proof that the app in the URL is one the caller may read, and
 * the two ways that proof can be wrong: a stranger's sigil id reached through
 * a project the caller does belong to, and a caller who belongs to nothing.
 */
describe("SigilAnalyticsController", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setup();
  });

  afterEach(async () => {
    await ctx.alepha.stop();
  });

  it("publishes the sigil datasets without the sigilId dimension", async ({
    expect,
  }) => {
    const project = await createTestProject(ctx.alepha);
    const sigil = await createTestSigil(ctx, project.id);

    const list = await ctx.controller.listAppDatasets(
      { params: { projectId: project.id, sigilId: sigil.id } },
      { user: ownerToken(project) },
    );

    // A census, so a dataset added without a thought about the per-app
    // Explore panel is a red test rather than a silent third entry.
    // `sigil_errors` joined on 2026-09-04 (feedback #2085).
    expect(list.map((entry) => entry.name).sort()).toEqual([
      "sigil_errors",
      "sigil_views",
      "sigil_vitals",
    ]);
    for (const entry of list) {
      expect(entry.dimensions.properties).not.toHaveProperty("sigilId");
    }
    // The dimensions that are not the scope must survive, or the panel has
    // nothing to group by.
    const views = list.find((entry) => entry.name === "sigil_views");
    expect(views?.dimensions.properties).toHaveProperty("path");
  });

  it("counts only the rows of the app in the URL", async ({ expect }) => {
    const project = await createTestProject(ctx.alepha);
    const mine = await createTestSigil(ctx, project.id);
    const theirs = await createTestSigil(ctx, project.id);

    await ctx.datasets.views.record({
      sigilId: mine.id,
      path: "/",
      country: "FR",
      count: 2,
      hour: "2026-08-01T10",
    });
    await ctx.datasets.views.record({
      sigilId: theirs.id,
      path: "/",
      country: "FR",
      count: 9,
      hour: "2026-08-01T10",
    });

    const result = await ctx.controller.queryAppDataset(
      {
        params: {
          projectId: project.id,
          sigilId: mine.id,
          name: "sigil_views",
        },
        body: {
          since: "2026-01-01",
          groupBy: ["path"],
          select: { count: "sum" },
        },
      },
      { user: ownerToken(project) },
    );

    // 2, not 11: the sibling app's rows are in the same dataset and the same
    // project, and the scope is the only thing keeping them out.
    expect(result.rows).toEqual([{ path: "/", count: 2 }]);
  });

  it("refuses a sigil that belongs to another project", async ({ expect }) => {
    // The membership check is on the PROJECT, so a sigil id from the client
    // has to be proved to belong to it. Without that proof this reads another
    // project's traffic through a project the caller is a legitimate member
    // of — which is the whole reason the scope cannot be a UI concern.
    const project = await createTestProject(ctx.alepha);
    const other = await createTestProject(ctx.alepha);
    const stranger = await createTestSigil(ctx, other.id);

    await expect(
      ctx.controller.queryAppDataset(
        {
          params: {
            projectId: project.id,
            sigilId: stranger.id,
            name: "sigil_views",
          },
          body: { since: "2026-01-01", select: { count: "sum" } },
        },
        { user: ownerToken(project) },
      ),
    ).rejects.toThrow(NotFoundError);
  });

  it("refuses a caller who is not a member of the project", async ({
    expect,
  }) => {
    const project = await createTestProject(ctx.alepha);
    const sigil = await createTestSigil(ctx, project.id);
    const outsider = await createTestProject(ctx.alepha);

    await expect(
      ctx.controller.queryAppDataset(
        {
          params: {
            projectId: project.id,
            sigilId: sigil.id,
            name: "sigil_views",
          },
          body: { since: "2026-01-01", select: { count: "sum" } },
        },
        { user: ownerToken(outsider) },
      ),
    ).rejects.toThrow(ForbiddenError);
  });

  it("refuses an app that does not collect beacon telemetry", async ({
    expect,
  }) => {
    // Same gate, and the same 404 rather than 403, as the Analytics and
    // Vitals tabs: the tab is hidden on exactly this condition, so reaching
    // it by URL is asking for a page that does not exist here.
    const project = await createTestProject(ctx.alepha);
    const sigil = await createTestSigil(ctx, project.id, { kinds: [] });

    await expect(
      ctx.controller.listAppDatasets(
        { params: { projectId: project.id, sigilId: sigil.id } },
        { user: ownerToken(project) },
      ),
    ).rejects.toThrow(NotFoundError);
  });

  it("refuses a body that names the pinned dimension", async ({ expect }) => {
    // A caller cannot re-point the scope by setting it themselves. Refused,
    // never silently overwritten: overwriting answers a question nobody
    // asked, and the caller believes it filtered when it did not.
    const project = await createTestProject(ctx.alepha);
    const mine = await createTestSigil(ctx, project.id);
    const theirs = await createTestSigil(ctx, project.id);

    await expect(
      ctx.controller.queryAppDataset(
        {
          params: {
            projectId: project.id,
            sigilId: mine.id,
            name: "sigil_views",
          },
          body: {
            since: "2026-01-01",
            where: { sigilId: theirs.id },
            select: { count: "sum" },
          },
        },
        { user: ownerToken(project) },
      ),
    ).rejects.toThrow(BadRequestError);
  });
});
