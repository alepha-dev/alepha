import { DashboardMetricRegistry } from "@lore/core/api";
import { type DashboardCardValue, projects } from "@lore/core/schemas";
import {
  PersonaController,
  RequirementController,
  RequirementsCoverageSnapshot,
  RunController,
  UseCaseController,
} from "@lore/plan-requirements/api";
import { requirements } from "@lore/plan-requirements/schemas";
import { ReleaseController } from "@lore/plan/api";
import { $repository } from "alepha/orm";
import { afterEach, describe, it } from "vitest";

import {
  type RequirementsProject,
  requirementsProject,
} from "./fixtures/requirementsProject.ts";

/**
 * The Requirements dashboard cards (#E153, #Q3775): coverage, release
 * readiness, use case health, not covered yet, personas, coverage over time,
 * and the Needs you rows.
 */
class ProjectProbe {
  projects = $repository(projects);
  requirements = $repository(requirements);
}

describe("requirements dashboard cards", () => {
  let ctx: RequirementsProject;

  afterEach(async () => {
    await ctx.alepha.stop();
  });

  const setup = async () => {
    ctx = await requirementsProject({ probes: [ProjectProbe] });
    const as = ctx.as(ctx.owner);
    const personas = ctx.alepha.inject(PersonaController);
    const useCases = ctx.alepha.inject(UseCaseController);
    const requirementApi = ctx.alepha.inject(RequirementController);
    const runs = ctx.alepha.inject(RunController);
    const releases = ctx.alepha.inject(ReleaseController);

    const lea = (
      await personas.createPersona.fetch(
        { params: { projectId: ctx.projectId }, body: { name: "Léa" } },
        as,
      )
    ).data;
    const release = (
      await releases.createRelease.fetch(
        { params: { projectId: ctx.projectId }, body: { tag: "2.4.0" } },
        as,
      )
    ).data;
    const uc = (
      await useCases.createUseCase.fetch(
        {
          params: { projectId: ctx.projectId },
          body: {
            title: "Apply a code",
            actors: [{ personaId: lea.id }],
            criteria: [{ text: "The discount shows" }],
          } as never,
        },
        as,
      )
    ).data;
    await useCases.createUseCase.fetch(
      {
        params: { projectId: ctx.projectId },
        body: { title: "Export the orders" } as never,
      },
      as,
    );
    const verified = (
      await requirementApi.createRequirement.fetch(
        {
          params: { projectId: ctx.projectId },
          body: {
            statement: "The discount is visible",
            priority: "must",
            targetReleaseId: release.id,
          },
        },
        as,
      )
    ).data;
    await requirementApi.createRequirement.fetch(
      {
        params: { projectId: ctx.projectId },
        body: {
          statement: "Receipts are mailed",
          priority: "should",
          targetReleaseId: release.id,
        },
      },
      as,
    );
    await requirementApi.createRequirement.fetch(
      {
        params: { projectId: ctx.projectId },
        body: { statement: "Webhooks are idempotent", priority: "must" },
      },
      as,
    );
    await requirementApi.linkCriterion.fetch(
      {
        params: { projectId: ctx.projectId },
        body: {
          useCaseNumber: uc.number,
          criterionKey: "C1",
          requirementNumber: verified.number,
        },
      },
      as,
    );
    await runs.recordUseCaseRun.fetch(
      {
        params: { projectId: ctx.projectId },
        body: {
          useCaseNumber: uc.number,
          by: "agent",
          env: "local",
          results: [{ key: "C1", result: "passed" }],
        },
      },
      as,
    );

    const project = await ctx.alepha
      .inject(ProjectProbe)
      .projects.getOne({ where: { id: { eq: ctx.projectId } } });
    const resolve = async (
      metric: string,
      scope: Record<string, unknown> = {
        kind: "projects",
        projectIds: [ctx.projectId],
      },
    ): Promise<DashboardCardValue> =>
      (
        await ctx.alepha.inject(DashboardMetricRegistry).resolveForProject(
          [
            {
              id: 1,
              metric,
              scope,
              filters: {},
              size: 1,
              position: 0,
            } as never,
          ],
          (as as unknown as { user: never }).user,
          project,
        )
      )[0]!;
    return { release, resolve, verified };
  };

  it("draws coverage and readiness from the stored statuses", async ({
    expect,
  }) => {
    const t = await setup();
    const coverage = await t.resolve("requirementCoverage");
    expect(coverage.ok).toBe(true);
    expect(coverage.value).toBe(33);
    expect(
      Object.fromEntries(
        (coverage.segments ?? []).map((it) => [it.label, it.value]),
      ),
    ).toEqual({
      verified: 1,
      failing: 0,
      devPlanned: 0,
      specified: 0,
      notCovered: 2,
    });

    const readiness = await t.resolve("releaseReadiness", {
      kind: "release",
      releaseId: t.release.id,
    });
    expect(readiness.value).toBe(100);
    expect(readiness.detail).toMatchObject({
      mustVerified: 1,
      mustTotal: 1,
      shouldVerified: 0,
      shouldTotal: 1,
    });
  });

  it("draws use case health, what is left to cover and each persona", async ({
    expect,
  }) => {
    const t = await setup();
    const health = await t.resolve("useCaseHealth");
    expect(health.value).toBe(50);
    expect(health.detail).toMatchObject({ passed: 1, total: 2, stale: 0 });

    const toCover = await t.resolve("requirementsToCover");
    expect(toCover.value).toBe(2);
    expect(toCover.rows?.map((it) => it.badge)).toEqual(["must", "should"]);

    const personas = await t.resolve("personaHealth");
    expect(personas.rows).toEqual([
      expect.objectContaining({ title: "#A1 Léa", progress: 100, meta: "1/1" }),
    ]);
  });

  it("draws coverage over time from the daily snapshot, and nothing before it", async ({
    expect,
  }) => {
    const t = await setup();
    expect((await t.resolve("requirementCoverageTrend")).empty).toBe("noData");
    const written = await ctx.alepha
      .inject(RequirementsCoverageSnapshot)
      .snapshot(ctx.projectId);
    expect(written).toBe(2);
    const trend = await t.resolve("requirementCoverageTrend");
    expect(trend.value).toBe(33);
    expect(trend.series).toHaveLength(1);
    expect(trend.detail).toMatchObject({ covered: 33 });
    const forRelease = await t.resolve("requirementCoverageTrend", {
      kind: "release",
      releaseId: t.release.id,
    });
    expect(forRelease.value).toBe(50);
  });

  it("adds a changed specification to Needs you", async ({ expect }) => {
    const t = await setup();
    await ctx.alepha
      .inject(ProjectProbe)
      .requirements.updateById(t.verified.id, { sourceChanged: true });
    const needs = await t.resolve("needsYou");
    expect(needs.rows?.map((it) => it.badge)).toContain("sourceChanged");
  });
});
