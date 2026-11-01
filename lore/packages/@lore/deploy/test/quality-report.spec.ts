import { projects } from "@lore/core/schemas";
import { Alepha } from "alepha";
import { AnalyticsProvider, OrmAnalyticsProvider } from "alepha/api/analytics";
import { UserService } from "alepha/api/users";
import { $repository, AlephaOrm } from "alepha/orm";
import { describe, it } from "vitest";

import { artifacts } from "../src/api/entities/artifacts.ts";
import { qualityRuns } from "../src/api/entities/qualityRuns.ts";
import { LoreDeployApi } from "../src/api/index.ts";
import { ProjectQualityReportService } from "../src/api/services/ProjectQualityReportService.ts";

class Repositories {
  projects = $repository(projects);
  runs = $repository(qualityRuns);
  artifacts = $repository(artifacts);
}

/**
 * Quality as a section of the Delivery tab (#Q3010).
 */
describe("ProjectQualityReportService", () => {
  const setup = async () => {
    const alepha = Alepha.create({
      env: { DATABASE_URL: ":memory:", LOG_LEVEL: "error" },
    })
      .with({ provide: AnalyticsProvider, use: OrmAnalyticsProvider })
      .with(AlephaOrm)
      .with(LoreDeployApi);
    const repos = alepha.inject(Repositories);
    await alepha.start();
    const owner = await alepha
      .inject(UserService)
      .createUser({ username: "quality-owner" });
    const project = await repos.projects.create({
      title: "Quality",
      createdBy: owner.id,
      coverageTarget: 80,
    });
    const run = (day: string, branch: string, lines: number, sha = "abcdef1") =>
      repos.runs.create({
        projectId: project.id,
        day,
        branch,
        commitSha: sha,
        coverageLines: lines,
        coverageStatements: lines,
        coverageFunctions: lines,
        coverageBranches: lines,
        testsTotal: 1,
        testsPassed: 1,
        testsFailed: 0,
        testsSkipped: 0,
        durationMs: 1000,
      } as never);
    return { alepha, repos, project, run };
  };

  const report = (
    alepha: Alepha,
    projectId: number,
    query: Parameters<ProjectQualityReportService["report"]>[1],
  ) =>
    alepha
      .inject(ProjectQualityReportService)
      .report(projectId, query, (row) => row as never);

  it("reads main unless asked, lists every branch and carries the target", async ({
    expect,
  }) => {
    const ctx = await setup();
    try {
      await ctx.run("2026-06-02", "main", 70);
      await ctx.run("2026-06-03", "topic", 10);

      const data = await report(ctx.alepha, ctx.project.id, {});

      expect(data.latest?.coverageLines).toBe(70);
      expect(data.branch).toBe("main");
      expect(data.branches.toSorted()).toEqual(["main", "topic"]);
      expect(data.target).toBe(80);

      const topic = await report(ctx.alepha, ctx.project.id, {
        branch: "topic",
      });
      expect(topic.latest?.coverageLines).toBe(10);
    } finally {
      await ctx.alepha.stop();
    }
  });

  it("compares the period with the last run before it", async ({ expect }) => {
    const ctx = await setup();
    try {
      await ctx.run("2026-05-01", "main", 50);
      await ctx.run("2026-05-20", "main", 60);
      await ctx.run("2026-06-02", "main", 70);

      const data = await report(ctx.alepha, ctx.project.id, {
        from: "2026-06-01T00:00:00.000Z",
      });

      expect(data.runs).toHaveLength(1);
      expect(data.previous?.coverageLines).toBe(60);
    } finally {
      await ctx.alepha.stop();
    }
  });

  it("gives a tag the newest run of its commit, by prefix", async ({
    expect,
  }) => {
    const ctx = await setup();
    try {
      await ctx.run("2026-06-01", "main", 60, "abcdef1234");
      await ctx.run("2026-06-02", "main", 70, "abcdef1234");
      await ctx.repos.artifacts.create({
        projectId: ctx.project.id,
        app: "web",
        tag: "1.0.0",
        runtime: "node",
        sha256: "0".repeat(64),
        commitSha: "abcdef1",
      } as never);

      const data = await report(ctx.alepha, ctx.project.id, {});

      expect(data.coverageByTag).toEqual([
        { tag: "1.0.0", day: "2026-06-02", coverage: 70 },
      ]);
    } finally {
      await ctx.alepha.stop();
    }
  });
});
