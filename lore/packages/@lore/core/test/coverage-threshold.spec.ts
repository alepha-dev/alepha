import { ProjectThresholds, projectEvents } from "@lore/core/api";
import { Alepha } from "alepha";
import { AlephaApiUsers } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { $repository, AlephaOrm } from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { describe, it } from "vitest";

import {
  CoverageThreshold,
  LoreCoreApi,
  QualityController,
} from "../src/api/index.ts";
import { CoreTestEntities, createTestProject } from "../src/testing/index.ts";

class Repositories {
  events = $repository(projectEvents);
}
/**
 * The coverage threshold (#Q3894), core's Quality since #Q4217: set in settings,
 * `coverage.dropped` recorded once when a push on main crosses it, rearmed
 * when coverage returns. The open-errors one is Ship's spec.
 */
describe("Coverage threshold", () => {
  const setup = async () => {
    const alepha = Alepha.create({
      env: { LOG_LEVEL: "error", DATABASE_URL: ":memory:" },
    });
    alepha.with(AlephaOrm);
    alepha.with(AlephaServer);
    alepha.with(AlephaSecurity);
    alepha.with(AlephaEmail);
    alepha.with(AlephaApiUsers);
    alepha.with(LoreCoreApi);
    alepha.inject(CoreTestEntities);
    const repos = alepha.inject(Repositories);
    await alepha.start();
    const project = await createTestProject(alepha);
    return {
      alepha,
      repos,
      project,
      thresholds: alepha.inject(ProjectThresholds),
      events: (name: string) =>
        repos.events.count({ projectId: project.id, name }),
    };
  };
  const push = (
    alepha: Alepha,
    projectId: number,
    lines: number,
    commitSha: string,
    branch = "main",
  ) =>
    alepha
      .inject(CoverageThreshold)
      .onCoverage(projectId, { branch, commitSha, lines }, undefined);

  it("records coverage.dropped once when a push on main crosses, and rearms above", async ({
    expect,
  }) => {
    const { alepha, project, thresholds, events } = await setup();
    await thresholds.set(project.id, { coverageMin: 80 });
    expect(await push(alepha, project.id, 85, "a")).toBe(false);
    expect(await push(alepha, project.id, 79, "b")).toBe(true);
    expect(await push(alepha, project.id, 70, "c")).toBe(false);
    expect(await push(alepha, project.id, 60, "d", "topic")).toBe(false);
    expect(await events("coverage.dropped")).toBe(1);
    expect(await push(alepha, project.id, 81, "e")).toBe(false);
    expect(await push(alepha, project.id, 75, "f")).toBe(true);
    expect(await events("coverage.dropped")).toBe(2);
    await alepha.stop();
  });

  it("checks coverage from the push action, with the previous value on main", async ({
    expect,
  }) => {
    const { alepha, project, thresholds, repos } = await setup();
    await thresholds.set(project.id, { coverageMin: 80 });
    const quality = alepha.inject(QualityController);
    const body = (lines: number, commitSha: string) => ({
      commitSha,
      branch: "main",
      coverage: { lines, statements: lines, functions: lines, branches: lines },
      tests: { total: 1, passed: 1, failed: 0, skipped: 0 },
      durationMs: 1000,
    });
    await quality.pushQualityRun.fetch(
      {
        params: { projectId: project.id },
        body: body(90, "a".repeat(40)),
      },
      { user: { id: project.createdBy, roles: ["user"] } },
    );
    await quality.pushQualityRun.fetch(
      {
        params: { projectId: project.id },
        body: body(70, "b".repeat(40)),
      },
      { user: { id: project.createdBy, roles: ["user"] } },
    );
    const [event] = await repos.events.findMany({
      where: { projectId: project.id, name: "coverage.dropped" },
    });
    expect(event.fields).toMatchObject({
      value: 70,
      previous: 90,
      threshold: 80,
      branch: "main",
    });
    await alepha.stop();
  });

  it("records nothing for a project with no threshold", async ({ expect }) => {
    const { alepha, project, events } = await setup();
    expect(await push(alepha, project.id, 1, "a")).toBe(false);
    expect(await events("coverage.dropped")).toBe(0);
    await alepha.stop();
  });
});
