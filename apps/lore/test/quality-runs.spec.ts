import { Alepha, z } from "alepha";
import { AdminUserController, AlephaApiUsers } from "alepha/api/users";
import { DateTimeProvider } from "alepha/datetime";
import { AlephaEmail } from "alepha/email";
import { AlephaFake, FakeProvider } from "alepha/fake";
import { $repository, AlephaOrm } from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { afterEach, beforeEach, describe, it } from "vitest";

import { ProjectController } from "../src/api/controllers/ProjectController.ts";
import { QualityController } from "../src/api/controllers/QualityController.ts";
import {
  defaultProjectFeatures,
  projectFeaturesSchema,
} from "../src/api/entities/projects.ts";
import { qualityRuns } from "../src/api/entities/qualityRuns.ts";
import { LoreApi } from "../src/api/index.ts";
import { QualityJobs } from "../src/api/jobs/QualityJobs.ts";
import type { QualityRunPush } from "../src/api/schemas/qualityRunPushSchema.ts";
import { ProjectLimits } from "../src/api/services/ProjectLimits.ts";
import { QualityService } from "../src/api/services/QualityService.ts";

/**
 * The Lore half of epic #15: a CI job pushes what a test run measured, and the
 * Reports tab reads it back.
 *
 * Three properties here are the ones that would be quietly wrong rather than
 * loudly broken:
 *
 * - **A push is never refused because the UI switch is off.** A feature toggle
 *   that can turn someone's CI red is not a feature toggle.
 * - **A second push on the same branch and day REPLACES the first.** One row
 *   is one branch-day; the tab plots a daily timeline and the newest
 *   measurement of a day is the one that describes it.
 * - **The day is stamped server-side.** A caller naming its own bucket could
 *   overwrite any day it liked, and a CI runner's timezone would decide which
 *   one its push landed in.
 */
const adminUser = { id: crypto.randomUUID(), roles: ["admin"] };

const userDataSchema = z.object({
  username: z.string(),
  email: z.email(),
});

class TestRows {
  public readonly runs = $repository(qualityRuns);
}

interface TestContext {
  alepha: Alepha;
  adminUserController: AdminUserController;
  projectController: ProjectController;
  qualityController: QualityController;
  quality: QualityService;
  rows: TestRows;
  fakeProvider: FakeProvider;
}

const setup = async (): Promise<TestContext> => {
  const alepha = Alepha.create({
    env: {
      LOG_LEVEL: "error",
      SERVER_PORT: 0,
      DATABASE_URL: ":memory:",
    },
  });

  alepha.with(AlephaOrm);
  alepha.with(AlephaServer);
  alepha.with(AlephaSecurity);
  alepha.with(AlephaEmail);
  alepha.with(AlephaApiUsers);
  alepha.with(AlephaFake);
  alepha.with(LoreApi);
  alepha.with(TestRows);

  await alepha.start();

  return {
    alepha,
    adminUserController: alepha.inject(AdminUserController),
    projectController: alepha.inject(ProjectController),
    qualityController: alepha.inject(QualityController),
    quality: alepha.inject(QualityService),
    rows: alepha.inject(TestRows),
    fakeProvider: alepha.inject(FakeProvider),
  };
};

const createTestUser = async (ctx: TestContext) => {
  const fakeUser = ctx.fakeProvider.generate(userDataSchema);
  const response = await ctx.adminUserController.createUser.fetch(
    { body: { ...fakeUser, roles: ["user"] } },
    { user: adminUser },
  );
  return { id: response.data.id, roles: response.data.roles };
};

/**
 * What `lore quality push` sends: the totals extracted from the two
 * vitest reports, and nothing else. ~200 bytes - the reports themselves used
 * to ride along and made the request 31x the server's body limit.
 */
const aRun = (overrides: Partial<QualityRunPush> = {}): QualityRunPush => ({
  commitSha: "0b35cb375",
  branch: "main",
  coverage: { lines: 71.2, statements: 70.9, functions: 64.4, branches: 82.1 },
  tests: { total: 8526, passed: 8524, failed: 0, skipped: 2 },
  durationMs: 132_000,
  ...overrides,
});

describe("quality runs", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setup();
  });

  afterEach(async () => {
    await ctx.alepha.stop();
  });

  /**
   * `quality` was a project flag and is not one any more: Quality joins the
   * Apps baseline, so what these cases used to say with `{ quality: true }`
   * they now say by giving the project the Apps capability. The push path is
   * unaffected either way - a CI credential is never gated on a switch in the
   * UI, which is the rule this file exists to hold.
   */
  const aProject = async (apps = false) => {
    const owner = await createTestUser(ctx);
    const project = await ctx.projectController.createProject.fetch(
      {
        body: {
          title: `Quality ${crypto.randomUUID().slice(0, 8)}`,
          capabilities: apps ? [{ key: "apps" as const }] : [],
        },
      },
      { user: owner },
    );
    return { owner, projectId: project.data.id };
  };

  const push = async (
    projectId: number,
    user: { id: string },
    body: QualityRunPush = aRun(),
  ) =>
    ctx.qualityController.pushQualityRun.fetch(
      { params: { projectId }, body },
      { user },
    );

  const today = () =>
    ctx.alepha.inject(DateTimeProvider).nowISOString().slice(0, 10);

  /**
   * A row for a day that is not today.
   *
   * Written straight to the table rather than pushed, because the endpoint
   * stamps `day` itself and the only other way to move it is `travel()` -
   * which releases every cron in the container and would make each of Lore's
   * other jobs a participant in these tests.
   */
  const seed = async (
    projectId: number,
    day: string,
    overrides: Record<string, unknown> = {},
  ) =>
    ctx.rows.runs.create({
      projectId,
      day,
      commitSha: day.replaceAll("-", ""),
      branch: "main",
      coverageLines: 71.2,
      coverageStatements: 70.9,
      coverageFunctions: 64.4,
      coverageBranches: 82.1,
      testsTotal: 8526,
      testsPassed: 8524,
      testsFailed: 0,
      testsSkipped: 2,
      durationMs: 132_000,
      ...overrides,
    });

  describe("the feature flag", () => {
    it("is optional, so an existing row decodes without it", ({ expect }) => {
      const shape = z.schema.shape(projectFeaturesSchema);

      expect(shape.quality).toBeDefined();
      expect(z.schema.isOptional(shape.quality)).toBe(true);
    });

    /**
     * A key here changes the column DEFAULT, and on D1 that rebuilds
     * `projects` - the CASCADE parent that wiped production once already.
     */
    it("stays out of defaultProjectFeatures", ({ expect }) => {
      expect("quality" in defaultProjectFeatures).toBe(false);
    });
  });

  describe("pushing a run", () => {
    it("records the totals", async ({ expect }) => {
      const { owner, projectId } = await aProject();

      await push(projectId, owner);

      const rows = await ctx.rows.runs.findMany({
        where: { projectId: { eq: projectId } },
      });
      expect(rows).toHaveLength(1);
      expect(rows[0].commitSha).toBe("0b35cb375");
      expect(rows[0].branch).toBe("main");
      expect(rows[0].coverageLines).toBeCloseTo(71.2);
      expect(rows[0].testsTotal).toBe(8526);
      expect(rows[0].testsSkipped).toBe(2);
      expect(rows[0].durationMs).toBe(132_000);
    });

    /**
     * The day is the server's, never the caller's: nothing in
     * `qualityRunPushSchema` can name it.
     */
    it("stamps the UTC day itself", async ({ expect }) => {
      const { owner, projectId } = await aProject();

      const response = await push(projectId, owner);

      expect(response.data.day).toBe(today());
    });

    /**
     * Point 2 of the whole design. Eleven pushes in a day leave one row: the
     * eleventh.
     */
    it("replaces the run already pushed today on that branch", async ({
      expect,
    }) => {
      const { owner, projectId } = await aProject();

      const first = await push(
        projectId,
        owner,
        aRun({ commitSha: "1111111" }),
      );
      const second = await push(
        projectId,
        owner,
        aRun({
          commitSha: "2222222",
          tests: { total: 8526, passed: 8526, failed: 0, skipped: 0 },
        }),
      );

      const rows = await ctx.rows.runs.findMany({
        where: { projectId: { eq: projectId } },
      });
      expect(rows).toHaveLength(1);
      expect(rows[0].commitSha).toBe("2222222");
      expect(rows[0].testsPassed).toBe(8526);
      expect(rows[0].testsSkipped).toBe(0);

      // Upserted onto the same row rather than deleted and rewritten, which is
      // what keeps `createdAt` meaning "first push of this day".
      expect(second.data.id).toBe(first.data.id);
      expect(second.data.createdAt).toBe(first.data.createdAt);
    });

    it("keeps a row per day", async ({ expect }) => {
      const { owner, projectId } = await aProject();

      await seed(projectId, "2026-08-29");
      await seed(projectId, "2026-08-30");
      await push(projectId, owner);

      const rows = await ctx.rows.runs.findMany({
        where: { projectId: { eq: projectId } },
      });
      expect(rows).toHaveLength(3);
    });

    /**
     * `branch` is part of the key, so a topic branch pushing on the same day
     * does not evict `main`'s row.
     */
    it("keeps a topic branch's run beside main's", async ({ expect }) => {
      const { owner, projectId } = await aProject();

      await push(projectId, owner, aRun({ branch: "main" }));
      await push(
        projectId,
        owner,
        aRun({ branch: "topic", commitSha: "deadbee" }),
      );

      const rows = await ctx.rows.runs.findMany({
        where: { projectId: { eq: projectId } },
      });
      expect(rows).toHaveLength(2);
      expect(rows.map((it) => it.branch).sort()).toEqual(["main", "topic"]);
    });

    it("reports the newest row on the branch as latest", async ({ expect }) => {
      const { owner, projectId } = await aProject();

      await seed(projectId, "2026-08-29", { commitSha: "olderone" });
      await push(projectId, owner, aRun({ branch: "topic" }));
      await push(projectId, owner, aRun({ commitSha: "cafebabe" }));

      const latest = await ctx.quality.findLatest(projectId, "main");
      expect(latest?.commitSha).toBe("cafebabe");
    });

    /**
     * The decision that keeps a UI switch from turning CI red. The row is
     * written; the tab is what stays hidden.
     */
    it("is accepted while features.quality is off", async ({ expect }) => {
      const { owner, projectId } = await aProject(false);

      const response = await push(projectId, owner);

      expect(response.status).toBe(200);
      const rows = await ctx.rows.runs.findMany({
        where: { projectId: { eq: projectId } },
      });
      expect(rows).toHaveLength(1);
    });

    it("refuses a caller who is not a member", async ({ expect }) => {
      const { projectId } = await aProject();
      const stranger = await createTestUser(ctx);

      await expect(
        ctx.qualityController.pushQualityRun.fetch(
          { params: { projectId }, body: aRun() },
          { user: stranger },
        ),
      ).rejects.toThrowError(/Not a member of this project/);

      expect(
        await ctx.rows.runs.findMany({
          where: { projectId: { eq: projectId } },
        }),
      ).toHaveLength(0);
    });
  });

  describe("reading it back", () => {
    it("returns the latest run and the series behind it", async ({
      expect,
    }) => {
      const { owner, projectId } = await aProject(true);

      await seed(projectId, "2026-08-29");
      await push(projectId, owner, aRun({ commitSha: "2222222" }));

      const response = await ctx.qualityController.getQualityRuns.fetch(
        { params: { projectId } },
        { user: owner },
      );

      expect(response.data.latest?.commitSha).toBe("2222222");
      expect(response.data.runs).toHaveLength(2);
      // Newest day first, which is the order the tab reverses to plot.
      expect(response.data.runs.map((it) => it.day)).toEqual([
        today(),
        "2026-08-29",
      ]);
    });

    /**
     * `updatedAt` is what the staleness line renders: with one row per day,
     * `createdAt` is that day's first push and would date the figures hours
     * before they were measured.
     */
    it("carries both stamps and the day", async ({ expect }) => {
      const { owner, projectId } = await aProject(true);

      const response = await push(projectId, owner);

      expect(response.data.day).toBe(today());
      expect(typeof response.data.createdAt).toBe("string");
      expect(typeof response.data.updatedAt).toBe("string");
    });
  });

  describe("QualityService owns removal", () => {
    it("removes the row", async ({ expect }) => {
      const { owner, projectId } = await aProject();
      const pushed = await push(projectId, owner);

      await ctx.quality.delete(pushed.data.id);

      expect(
        await ctx.rows.runs.findOne({ where: { id: { eq: pushed.data.id } } }),
      ).toBeUndefined();
    });

    it("prunes past the cap, oldest day first", async ({ expect }) => {
      const { projectId } = await aProject();

      for (const day of ["2026-08-28", "2026-08-29", "2026-08-30"]) {
        await seed(projectId, day);
      }

      const removed = await ctx.quality.prune(projectId, 2);

      expect(removed).toBe(1);
      const rows = await ctx.rows.runs.findMany({
        where: { projectId: { eq: projectId } },
      });
      expect(rows.map((it) => it.day).sort()).toEqual([
        "2026-08-29",
        "2026-08-30",
      ]);
    });
  });

  /**
   * The `$job` on top of `prune`, exercised through its own handler rather
   * than through `travel()`: releasing the container's whole cron schedule to
   * test one sweep makes every other job in Lore a participant in this test.
   */
  describe("the nightly sweep", () => {
    it("prunes every project past the cap", async ({ expect }) => {
      const first = await aProject();
      const second = await aProject();
      for (const day of ["2026-08-28", "2026-08-29", "2026-08-30"]) {
        await seed(first.projectId, day);
        await seed(second.projectId, day);
      }

      const limits = ctx.alepha.inject(ProjectLimits);
      await limits.limits.set({
        ...(await limits.limits.get()),
        maxQualityRunsPerProject: 1,
      });

      await ctx.alepha.inject(QualityJobs).pruneQualityRuns.trigger();

      for (const projectId of [first.projectId, second.projectId]) {
        const rows = await ctx.rows.runs.findMany({
          where: { projectId: { eq: projectId } },
        });
        expect(rows).toHaveLength(1);
        expect(rows[0].day).toBe("2026-08-30");
      }
    });
  });

  /**
   * `$client` resolves an action by NAME against the remote's registry, so the
   * CLI in `@alepha/lore/cli` calls this one by the string below. The path is
   * the other half of the contract.
   */
  describe("the wire contract", () => {
    it("keeps the push action's name and path", ({ expect }) => {
      const action = ctx.qualityController.pushQualityRun;

      expect(action.name).toBe("pushQualityRun");
      expect(action.options.path).toBe("/projects/:projectId/quality/runs");
      expect(action.options.method).toBe("POST");
    });
  });
});
