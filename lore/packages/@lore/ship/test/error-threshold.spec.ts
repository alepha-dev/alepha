import { ProjectThresholds, projectEvents } from "@lore/core/api";
import { $hook, Alepha } from "alepha";
import { AlephaApiUsers } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { $repository, AlephaOrm } from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { describe, it } from "vitest";

import {
  ErrorThreshold,
  LoreShipApi,
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
 * The open-errors threshold (#Q3894): set in settings,
 * `errors.threshold_crossed` recorded once when the hourly count crosses it,
 * rearmed when it falls back. The row is core's and the coverage threshold
 * Build's (#E162).
 */
describe("Open-errors threshold", () => {
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
      errorCheck: alepha.inject(ErrorThreshold),
      events: (name: string) =>
        repos.events.count({ projectId: project.id, name }),
    };
  };
  it("records errors.threshold_crossed once from the hourly check, and rearms when the count falls back", async ({
    expect,
  }) => {
    const { alepha, project, thresholds, errorCheck, repos, events } =
      await setup();
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
    expect(await errorCheck.checkErrors()).toBe(0);
    const second = await error("b");
    expect(await errorCheck.checkErrors()).toBe(1);
    expect(await errorCheck.checkErrors()).toBe(0);
    expect(await events("errors.threshold_crossed")).toBe(1);
    await repos.errors.updateById(second.id, { status: "resolved" } as never);
    expect(await errorCheck.checkErrors()).toBe(0);
    await error("c");
    expect(await errorCheck.checkErrors()).toBe(1);
    await alepha.stop();
  });

  it("records nothing for a project with no threshold", async ({ expect }) => {
    const { alepha, errorCheck, events } = await setup();
    expect(await errorCheck.checkErrors()).toBe(0);
    expect(await events("errors.threshold_crossed")).toBe(0);
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
