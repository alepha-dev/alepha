import { Alepha, z } from "alepha";
import { files } from "alepha/api/files";
import { AdminUserController, AlephaApiUsers } from "alepha/api/users";
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
 * Two properties here are the ones that would be quietly wrong rather than
 * loudly broken, and both come from decisions taken on 2026-08-30:
 *
 * - **A push is never refused because the UI switch is off.** A feature toggle
 *   that can turn someone's CI red is not a feature toggle.
 * - **A repeat commit sha appends.** A CI re-run on an unchanged commit is not
 *   a conflict, and a flaky suite re-run is information.
 */
const adminUser = { id: crypto.randomUUID(), roles: ["admin"] };

const userDataSchema = z.object({
  username: z.string(),
  email: z.email(),
});

class TestRows {
  public readonly runs = $repository(qualityRuns);
  public readonly files = $repository(files);
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
 * What `alepha lore quality push` sends: totals extracted from the two vitest
 * reports, plus the reports themselves.
 */
const aRun = (overrides: Partial<QualityRunPush> = {}): QualityRunPush => ({
  commitSha: "0b35cb375",
  branch: "main",
  coverage: { lines: 71.2, statements: 70.9, functions: 64.4, branches: 82.1 },
  tests: { total: 8526, passed: 8524, failed: 0, skipped: 2 },
  durationMs: 132_000,
  reports: {
    coverage: { total: { lines: { total: 100, covered: 71, pct: 71.2 } } },
    tests: { numTotalTests: 8526, numPassedTests: 8524 },
  },
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

  const aProject = async (features?: Record<string, boolean>) => {
    const owner = await createTestUser(ctx);
    const project = await ctx.projectController.createProject.fetch(
      {
        body: { title: `Quality ${crypto.randomUUID().slice(0, 8)}`, features },
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

    it("keeps the raw reports behind a fileId", async ({ expect }) => {
      const { owner, projectId } = await aProject();

      const response = await push(projectId, owner);

      const stored = await ctx.rows.files.findOne({
        where: { id: { eq: response.data.fileId } },
      });
      expect(stored).toBeDefined();
      expect(stored?.bucket).toBe(QualityService.BUCKET);
    });

    /**
     * No unique index on `commitSha`. A CI re-run is not a conflict.
     */
    it("appends on a repeated commit sha", async ({ expect }) => {
      const { owner, projectId } = await aProject();

      await push(projectId, owner);
      await push(
        projectId,
        owner,
        aRun({ tests: { total: 8526, passed: 8526, failed: 0, skipped: 0 } }),
      );

      const rows = await ctx.rows.runs.findMany({
        where: { projectId: { eq: projectId } },
      });
      expect(rows).toHaveLength(2);
    });

    it("reports the newest row on the branch as latest", async ({ expect }) => {
      const { owner, projectId } = await aProject();

      await push(projectId, owner, aRun({ branch: "main" }));
      await push(
        projectId,
        owner,
        aRun({ branch: "topic", commitSha: "deadbee" }),
      );
      await push(
        projectId,
        owner,
        aRun({ branch: "main", commitSha: "cafebabe" }),
      );

      const latest = await ctx.quality.findLatest(projectId, "main");
      expect(latest?.commitSha).toBe("cafebabe");
    });

    /**
     * The decision that keeps a UI switch from turning CI red. The row is
     * written; the tab is what stays hidden.
     */
    it("is accepted while features.quality is off", async ({ expect }) => {
      const { owner, projectId } = await aProject({ quality: false });

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
      const { owner, projectId } = await aProject({ quality: true });

      await push(projectId, owner, aRun({ commitSha: "1111111" }));
      await push(projectId, owner, aRun({ commitSha: "2222222" }));

      const response = await ctx.qualityController.getQualityRuns.fetch(
        { params: { projectId } },
        { user: owner },
      );

      expect(response.data.latest?.commitSha).toBe("2222222");
      expect(response.data.runs).toHaveLength(2);
    });

    /**
     * There is no physical foreign key between a run and its report file, so
     * the file row can go while the run stays. Losing the raw report must not
     * cost the totals, which are the part the tab actually renders.
     */
    it("survives a dangling fileId, without the raw report", async ({
      expect,
    }) => {
      const { owner, projectId } = await aProject({ quality: true });
      const pushed = await push(projectId, owner);

      await ctx.rows.files.deleteMany({
        id: { eq: pushed.data.fileId as string },
      });

      const response = await ctx.qualityController.getQualityRuns.fetch(
        { params: { projectId } },
        { user: owner },
      );

      expect(response.status).toBe(200);
      expect(response.data.latest?.commitSha).toBe("0b35cb375");
      expect(response.data.latest?.hasReport).toBe(false);
    });
  });

  describe("QualityService owns removal", () => {
    it("takes the bytes with the row", async ({ expect }) => {
      const { owner, projectId } = await aProject();
      const pushed = await push(projectId, owner);
      const fileId = pushed.data.fileId as string;

      await ctx.quality.delete(pushed.data.id);

      expect(
        await ctx.rows.runs.findOne({ where: { id: { eq: pushed.data.id } } }),
      ).toBeUndefined();
      expect(
        await ctx.rows.files.findOne({ where: { id: { eq: fileId } } }),
      ).toBeUndefined();
    });

    it("prunes past the cap, oldest first", async ({ expect }) => {
      const { owner, projectId } = await aProject();

      for (const sha of ["1111111", "2222222", "3333333"]) {
        await push(projectId, owner, aRun({ commitSha: sha }));
      }

      const removed = await ctx.quality.prune(projectId, 2);

      expect(removed).toBe(1);
      const rows = await ctx.rows.runs.findMany({
        where: { projectId: { eq: projectId } },
      });
      expect(rows.map((it) => it.commitSha).sort()).toEqual([
        "2222222",
        "3333333",
      ]);
    });

    /**
     * The reason the sweep has to go through the service rather than issue its
     * own `deleteMany`: `quality_runs.fileId` has no physical foreign key, so
     * a row deleted directly leaves its bytes in the bucket forever. That bug
     * has already shipped once, in `folio_blobs`.
     */
    it("takes the bytes when it prunes too", async ({ expect }) => {
      const { owner, projectId } = await aProject();
      const doomed = await push(
        projectId,
        owner,
        aRun({ commitSha: "1111111" }),
      );
      await push(projectId, owner, aRun({ commitSha: "2222222" }));

      await ctx.quality.prune(projectId, 1);

      expect(
        await ctx.rows.files.findOne({
          where: { id: { eq: doomed.data.fileId as string } },
        }),
      ).toBeUndefined();
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
      for (const sha of ["1111111", "2222222", "3333333"]) {
        await push(first.projectId, first.owner, aRun({ commitSha: sha }));
        await push(second.projectId, second.owner, aRun({ commitSha: sha }));
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
        expect(rows[0].commitSha).toBe("3333333");
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
