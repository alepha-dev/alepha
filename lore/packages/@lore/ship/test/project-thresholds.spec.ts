import { projectEvents } from "@lore/core/api";
import { $hook, Alepha } from "alepha";
import { AlephaApiUsers } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { $repository, AlephaOrm } from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { describe, it } from "vitest";

import {
  LoreShipApi,
  ProjectThresholds,
  QualityController,
  SigilIngestService,
} from "../src/api/index.ts";
import { projectErrors, sigils } from "../src/schemas/index.ts";
import { createTestProject, DeployTestEntities } from "../src/testing/index.ts";

class Repositories {
  sigils = $repository(sigils);
  errors = $repository(projectErrors);
  events = $repository(projectEvents);
}
/**
 * Every table a repository read or wrote while armed.
 */
class Touched {
  public armed = false;
  public tables = new Set<string>();
  protected readonly onRead = $hook({
    on: "repository:read:after",
    handler: ({ tableName }) => {
      if (this.armed) this.tables.add(tableName);
    },
  });
  protected readonly onCreate = $hook({
    on: "repository:create:after",
    handler: ({ tableName }) => {
      if (this.armed) this.tables.add(tableName);
    },
  });
}

/**
 * The coverage and open-errors thresholds (#Q3894): set in settings, each
 * an event recorded once when its value crosses, rearmed when it returns.
 */
describe("Project thresholds", () => {
  const setup = async () => {
    const alepha = Alepha.create({
      env: { LOG_LEVEL: "error", DATABASE_URL: ":memory:" },
    });
    alepha.with(AlephaOrm);
    alepha.with(AlephaServer);
    alepha.with(AlephaSecurity);
    alepha.with(AlephaEmail);
    alepha.with(AlephaApiUsers);
    alepha.with(LoreShipApi);
    alepha.inject(DeployTestEntities);
    const repos = alepha.inject(Repositories);
    const touched = alepha.inject(Touched);
    await alepha.start();
    const project = await createTestProject(alepha);
    return {
      alepha,
      repos,
      touched,
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
      .inject(ProjectThresholds)
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

  it("records errors.threshold_crossed once from the hourly check, and rearms when the count falls back", async ({
    expect,
  }) => {
    const { alepha, project, thresholds, repos, events } = await setup();
    await thresholds.set(project.id, { openErrorsMax: 1 });
    const error = (fingerprint: string) =>
      repos.errors.create({
        projectId: project.id,
        fingerprint,
        name: "TypeError",
        message: "boom",
        firstSeenAt: new Date().toISOString(),
        lastSeenAt: new Date().toISOString(),
      } as never);
    await error("a");
    expect(await thresholds.checkErrors()).toBe(0);
    const second = await error("b");
    expect(await thresholds.checkErrors()).toBe(1);
    expect(await thresholds.checkErrors()).toBe(0);
    expect(await events("errors.threshold_crossed")).toBe(1);
    await repos.errors.updateById(second.id, { status: "resolved" } as never);
    expect(await thresholds.checkErrors()).toBe(0);
    await error("c");
    expect(await thresholds.checkErrors()).toBe(1);
    await alepha.stop();
  });

  it("emits neither alert for a project with no threshold", async ({
    expect,
  }) => {
    const { alepha, project, thresholds, events } = await setup();
    expect(await push(alepha, project.id, 1, "a")).toBe(false);
    expect(await thresholds.checkErrors()).toBe(0);
    expect(await events("coverage.dropped")).toBe(0);
    await alepha.stop();
  });

  it("leaves the error ingest path untouched: an ingest reads no threshold and records no event", async ({
    expect,
  }) => {
    const { alepha, project, thresholds, repos, touched } = await setup();
    await thresholds.set(project.id, { openErrorsMax: 0 });
    const sigil = await repos.sigils.create({
      projectId: project.id,
      name: "ingest",
      tokenHash: "hash-ingest",
      tokenPrefix: "sg_test_",
      kinds: ["errors"],
    });
    touched.armed = true;
    await alepha.inject(SigilIngestService).absorb(sigil, {
      errors: [
        {
          name: "TypeError",
          message: "boom",
          stack: "at f (app.js:1:1)",
          sourceUrl: "https://app.example/",
          count: 1,
        },
      ],
    });
    touched.armed = false;
    expect(touched.tables.has("project_thresholds")).toBe(false);
    expect(touched.tables.has("project_events")).toBe(false);
    await alepha.stop();
  });
});
