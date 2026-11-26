import { jobKeys } from "@lore/core/schemas";
import { Alepha } from "alepha";
import { AlephaApiUsers } from "alepha/api/users";
import { DateTimeProvider } from "alepha/datetime";
import { AlephaEmail } from "alepha/email";
import { $repository, AlephaOrm } from "alepha/orm";
import { AlephaSecurity, type UserAccountToken } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { afterEach, beforeEach, describe, it } from "vitest";

import {
  LoreShipApi,
  ProjectErrorController,
  SigilIngestService,
} from "../src/api/index.ts";
import { RunErrorService } from "../src/api/services/RunErrorService.ts";
import {
  appInstances,
  deployments,
  projectErrors,
  type Sigil,
  sigils,
} from "../src/schemas/index.ts";
import { createTestProject, DeployTestEntities } from "../src/testing/index.ts";

class Repos {
  sigils = $repository(sigils);
  errors = $repository(projectErrors);
  instances = $repository(appInstances);
  deployments = $repository(deployments);
  keys = $repository(jobKeys);
}

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
  const entities = alepha.inject(DeployTestEntities);
  const repos = alepha.inject(Repos);
  const runs = alepha.inject(RunErrorService);
  const dateTime = alepha.inject(DateTimeProvider);
  await alepha.start();
  const created = await entities.users.create({});
  const owner: UserAccountToken = { id: created.id, roles: ["user"] };
  const project = await createTestProject(alepha, { createdBy: owner.id });
  return {
    alepha,
    repos,
    runs,
    dateTime,
    owner,
    projectId: project.id,
    controller: alepha.inject(ProjectErrorController),
    ingest: alepha.inject(SigilIngestService),
  };
};

type World = Awaited<ReturnType<typeof setup>>;

const enrol = (w: World, name: string, projectId = w.projectId) =>
  w.repos.sigils.create({
    projectId,
    name,
    tokenHash: `hash-${name}-${projectId}`,
    tokenPrefix: "sg_trend",
    kinds: ["errors"],
  });

const report = (w: World, sigil: Sigil, message: string, count = 1) =>
  w.ingest.absorb(sigil, {
    errors: [
      {
        name: "TypeError",
        message,
        stack: `TypeError: ${message}\n    at ${message.replace(/\s+/g, "_")} (app.js:12:3)`,
        sourceUrl: "https://acme.example/cart",
        origin: "server",
        count,
      },
    ],
  } as never);

const group = async (w: World, message: string) => {
  const [row] = await w.repos.errors.findMany({
    where: { message: { eq: message } },
  });
  if (!row) throw new Error(`no group "${message}"`);
  return row;
};

const trend = (w: World, errorId: number, user: UserAccountToken = w.owner) =>
  w.controller.getProjectErrorTrend.run(
    { params: { projectId: w.projectId, errorId } },
    { user },
  );

const day = (w: World) => w.dateTime.nowISOString().slice(0, 10);

/**
 * One error's daily occurrences over 30 days, with the project's deploys
 * marked (#E185).
 */
describe("getProjectErrorTrend", () => {
  let w: World;
  beforeEach(async () => {
    w = await setup();
  });
  afterEach(async () => {
    await w.alepha.stop();
  });

  it("reads one fingerprint's series across the project's apps, zero-filled, with a deploy marked", async ({
    expect,
  }) => {
    const web = await enrol(w, "web/production");
    const api = await enrol(w, "api/production");
    // Three days of reports: the watched error in both apps, another
    // fingerprint beside it every day.
    const seen: Record<string, number> = {};
    await report(w, web, "watched", 2);
    await report(w, web, "other", 5);
    seen[day(w)] = 2;
    await w.dateTime.travel(2, "day");
    await report(w, web, "watched", 1);
    await report(w, api, "watched", 3);
    await report(w, api, "other", 7);
    seen[day(w)] = 4;
    const instance = await w.repos.instances.create({
      projectId: w.projectId,
      app: "web",
      env: "production",
    });
    const finishedAt = w.dateTime.nowISOString();
    await w.repos.deployments.create({
      projectId: w.projectId,
      instanceId: instance.id,
      app: "web",
      tag: "1.3.0",
      sha256: "e".repeat(64),
      status: "succeeded",
      finishedAt,
    });
    // A failed deploy is no marker.
    await w.repos.deployments.create({
      projectId: w.projectId,
      instanceId: instance.id,
      app: "web",
      tag: "1.3.1",
      sha256: "f".repeat(64),
      status: "failed",
    });
    await w.dateTime.travel(1, "day");
    await report(w, web, "watched", 1);
    seen[day(w)] = 1;
    const row = await group(w, "watched");

    const answer = await trend(w, row.id);

    expect(answer.empty).toBe(false);
    expect(answer.series).toHaveLength(30);
    expect(answer.series.at(-1)?.at).toBe(day(w));
    expect(
      Object.fromEntries(
        answer.series
          .filter((point) => point.value > 0)
          .map((point) => [point.at, point.value]),
      ),
    ).toEqual(seen);
    // The day between the reports is a zero, not a missing point.
    expect(answer.series.at(-3)?.value).toBe(0);
    expect(answer.total).toBe(7);
    expect(answer.markers).toEqual([{ at: finishedAt, kind: "deploy" }]);
  });

  it("answers an explicit empty for a run error, an uptime error and a project with no app", async ({
    expect,
  }) => {
    const nothing = { empty: true, series: [], markers: [], total: 0 };
    await w.runs.failed({
      projectId: w.projectId,
      useCaseId: 9,
      useCaseRunId: 41,
      criterionKey: "C2",
      name: "CriterionFailed",
      message: "The cart keeps its items",
      stack: "Expected 2 items, found 0",
      at: w.dateTime.nowISOString(),
    });
    const uptime = await w.repos.errors.create({
      projectId: w.projectId,
      fingerprint: `uptime:${w.projectId}:${crypto.randomUUID()}`,
      name: "UptimeOutage",
      message: "Site: timeout",
      origin: "server",
      firstSeenAt: w.dateTime.nowISOString(),
      lastSeenAt: w.dateTime.nowISOString(),
    });
    // An app error whose app is gone: the project has no sigil left.
    const orphan = await w.repos.errors.create({
      projectId: w.projectId,
      fingerprint: "fp-orphan",
      name: "TypeError",
      message: "orphan",
      origin: "server",
      firstSeenAt: w.dateTime.nowISOString(),
      lastSeenAt: w.dateTime.nowISOString(),
    });

    expect(
      await trend(w, (await group(w, "The cart keeps its items")).id),
    ).toEqual(nothing);
    expect(await trend(w, uptime.id)).toEqual(nothing);
    expect(await trend(w, orphan.id)).toEqual(nothing);

    // With an app enrolled, the same app error has a series: thirty zeros
    // say it was not reported, which a run error could never say.
    await enrol(w, "web/production");
    const quiet = await trend(w, orphan.id);
    expect(quiet.empty).toBe(false);
    expect(quiet.series).toHaveLength(30);
    expect(quiet.total).toBe(0);
    // The others stay empty whatever the project holds.
    expect(await trend(w, uptime.id)).toEqual(nothing);
  });

  it("holds the gates of the single read: a 404 across projects, no agent on an untrusted error", async ({
    expect,
  }) => {
    const web = await enrol(w, "web/production");
    await w.ingest.absorb(web, {
      errors: [
        {
          name: "TypeError",
          message: "from a browser",
          stack: "TypeError: from a browser\n    at browser (app.js:1:1)",
          sourceUrl: "https://acme.example/",
          origin: "client",
        },
      ],
    } as never);
    const row = await group(w, "from a browser");
    const other = await createTestProject(w.alepha, { createdBy: w.owner.id });

    await expect(
      w.controller.getProjectErrorTrend.run(
        { params: { projectId: other.id, errorId: row.id } },
        { user: w.owner },
      ),
    ).rejects.toThrow("Error not found");

    const apiKeyId = crypto.randomUUID();
    await w.repos.keys.create({
      apiKeyId,
      jobId: crypto.randomUUID(),
      projectId: w.projectId,
      userId: w.owner.id,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    const job = {
      ...w.owner,
      credential: { type: "api-key", id: apiKeyId },
    } as UserAccountToken;
    await expect(trend(w, row.id, job)).rejects.toThrow("is not trusted yet");
    await w.controller.trustProjectError.run(
      { params: { projectId: w.projectId, errorId: row.id } },
      { user: w.owner },
    );
    expect((await trend(w, row.id, job)).total).toBe(1);
  });
});
