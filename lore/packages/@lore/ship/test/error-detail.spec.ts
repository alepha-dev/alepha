import { jobKeys } from "@lore/core/schemas";
import { TripCounter } from "@lore/core/testing";
import { Alepha } from "alepha";
import { AlephaApiUsers } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { $repository, AlephaOrm } from "alepha/orm";
import { AlephaSecurity, type UserAccountToken } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { afterEach, beforeEach, describe, it } from "vitest";

import { projectErrorIgnoreRules } from "../src/api/entities/projectErrorIgnoreRules.ts";
import {
  InsightsController,
  LoreShipApi,
  ProjectErrorController,
  SigilIngestService,
} from "../src/api/index.ts";
import { RunErrorService } from "../src/api/services/RunErrorService.ts";
import { projectErrors, type Sigil, sigils } from "../src/schemas/index.ts";
import { createTestProject, DeployTestEntities } from "../src/testing/index.ts";

class Repos {
  sigils = $repository(sigils);
  errors = $repository(projectErrors);
  rules = $repository(projectErrorIgnoreRules);
  keys = $repository(jobKeys);
}

const setup = async (options: { trips?: boolean } = {}) => {
  const alepha = Alepha.create({
    env: { LOG_LEVEL: "error", DATABASE_URL: ":memory:" },
  });
  alepha.with(AlephaOrm);
  alepha.with(AlephaServer);
  alepha.with(AlephaSecurity);
  alepha.with(AlephaEmail);
  alepha.with(AlephaApiUsers);
  alepha.with(LoreShipApi);
  if (options.trips) alepha.with(TripCounter);
  const entities = alepha.inject(DeployTestEntities);
  const repos = alepha.inject(Repos);
  const runs = alepha.inject(RunErrorService);
  await alepha.start();
  const created = await entities.users.create({});
  const owner: UserAccountToken = { id: created.id, roles: ["user"] };
  const project = await createTestProject(alepha, { createdBy: owner.id });
  const sigil = (name: string): Promise<Sigil> =>
    repos.sigils.create({
      projectId: project.id,
      name,
      tokenHash: `hash-${name}`,
      tokenPrefix: "sg_detail",
      kinds: ["errors"],
    });
  return {
    alepha,
    repos,
    runs,
    owner,
    projectId: project.id,
    web: await sigil("acme/production"),
    api: await sigil("acme-api/production"),
    controller: alepha.inject(ProjectErrorController),
    ingest: alepha.inject(SigilIngestService),
  };
};

type World = Awaited<ReturnType<typeof setup>>;

const report = (
  w: World,
  sigil: Sigil,
  message: string,
  extra: Record<string, unknown> = {},
) =>
  w.ingest.absorb(sigil, {
    errors: [
      {
        name: "TypeError",
        message,
        // The fingerprint is the name and the first frame: one frame per
        // message makes one group per message.
        stack: `TypeError: ${message}\n    at ${message.replace(/\s+/g, "_")} (app.js:12:3)`,
        sourceUrl: "https://acme.example/cart",
        origin: "client",
        ...extra,
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

const read = (w: World, errorId: number, user: UserAccountToken = w.owner) =>
  w.controller.getProjectError.run(
    { params: { projectId: w.projectId, errorId } },
    { user },
  );

/**
 * The caller an agent's job key makes: an API key whose `job_keys` row pins
 * it to the project (#Q3995).
 */
const asJob = async (w: World): Promise<UserAccountToken> => {
  const apiKeyId = crypto.randomUUID();
  await w.repos.keys.create({
    apiKeyId,
    jobId: crypto.randomUUID(),
    projectId: w.projectId,
    userId: w.owner.id,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  });
  return {
    ...w.owner,
    credential: { type: "api-key", id: apiKeyId },
  } as UserAccountToken;
};

/**
 * The read of one error (#E185): what the error page and `error_get` are
 * built on. Booted with Ship alone, so Plan is off here: the quest block is
 * the scenario spec's (`apps/lore/test/error-detail.spec.ts`).
 */
describe("getProjectError", () => {
  let w: World;
  beforeEach(async () => {
    w = await setup();
  });
  afterEach(async () => {
    await w.alepha.stop();
  });

  it("answers a browser error with its kind and one line per app that reported it", async ({
    expect,
  }) => {
    await report(w, w.web, "cart is undefined");
    await report(w, w.web, "cart is undefined");
    await report(w, w.api, "cart is undefined");
    await report(w, w.api, "another failure");
    const row = await group(w, "cart is undefined");

    const detail = await read(w, row.id);

    expect(detail.kind).toBe("sigil");
    expect(detail.error).toMatchObject({
      id: row.id,
      origin: "client",
      count: 3,
      status: "open",
      message: "cart is undefined",
    });
    expect(detail.error.trustedAt).toBeUndefined();
    expect(
      detail.apps.map((app) => ({ label: app.label, count: app.count })),
    ).toEqual([
      { label: "acme/production", count: 2 },
      { label: "acme-api/production", count: 1 },
    ]);
    expect(detail.apps[0]).toMatchObject({
      sigilId: w.web.id,
      firstSeenAt: expect.any(String),
      lastSeenAt: expect.any(String),
    });
    expect(detail.quest).toBeUndefined();
    expect(detail.run).toBeUndefined();
    expect(detail.monitor).toBeUndefined();
  });

  it("answers a server error trusted on arrival, linked to the browser error of the same request", async ({
    expect,
  }) => {
    await report(w, w.web, "request failed", { requestId: "req-1" });
    await report(w, w.api, "database is down", {
      origin: "server",
      requestId: "req-1",
    });
    const browser = await group(w, "request failed");
    const server = await group(w, "database is down");

    const detail = await read(w, server.id);

    expect(detail.kind).toBe("sigil");
    expect(detail.error.origin).toBe("server");
    expect(detail.error.trustedAt).toBeTruthy();
    expect(detail.error.trustedBy).toBeUndefined();
    expect(detail.error.linkedError).toEqual({
      id: browser.id,
      origin: "client",
    });
    expect((await read(w, browser.id)).error.linkedError).toEqual({
      id: server.id,
      origin: "server",
    });
  });

  it("answers an uptime error as its own kind, with its monitor and no app", async ({
    expect,
  }) => {
    const monitorId = crypto.randomUUID();
    const row = await w.repos.errors.create({
      projectId: w.projectId,
      fingerprint: `uptime:${w.projectId}:${monitorId}`,
      name: "UptimeOutage",
      message: "Site: timeout",
      origin: "server",
      firstSeenAt: "2026-11-01T10:00:00.000Z",
      lastSeenAt: "2026-11-01T10:00:00.000Z",
    });
    // The same fingerprint cannot be an app's, but an app's group must
    // never be read for it either.
    await report(w, w.web, "unrelated");

    const detail = await read(w, row.id);

    expect(detail.kind).toBe("uptime");
    expect(detail.error.origin).toBe("server");
    expect(detail.monitor).toEqual({ id: monitorId });
    expect(detail.apps).toEqual([]);
    expect(detail.run).toBeUndefined();
  });

  it("answers a run error with its run and criterion, and no app", async ({
    expect,
  }) => {
    await w.runs.failed({
      projectId: w.projectId,
      useCaseId: 9,
      useCaseRunId: 41,
      criterionKey: "C2",
      name: "CriterionFailed",
      message: "The cart keeps its items",
      stack: "Expected 2 items, found 0",
      at: "2026-11-01T10:00:00.000Z",
    });
    const row = await group(w, "The cart keeps its items");

    const detail = await read(w, row.id);

    expect(detail.kind).toBe("run");
    expect(detail.run).toEqual({ useCaseRunId: 41, criterionKey: "C2" });
    expect(detail.error.origin).toBe("run");
    expect(detail.apps).toEqual([]);
    expect(detail.monitor).toBeUndefined();
  });

  it("lists the ignore rules that match its message, and no other", async ({
    expect,
  }) => {
    await report(w, w.web, "ResizeObserver loop limit exceeded");
    const row = await group(w, "ResizeObserver loop limit exceeded");
    const matching = await w.repos.rules.create({
      projectId: w.projectId,
      pattern: "resizeobserver",
      createdBy: w.owner.id,
    });
    await w.repos.rules.create({
      projectId: w.projectId,
      pattern: "chunk load",
      createdBy: w.owner.id,
    });

    const detail = await read(w, row.id);

    expect(detail.rules.map((rule) => rule.id)).toEqual([matching.id]);
    expect(detail.rules[0]?.pattern).toBe("resizeobserver");
  });

  it("gives each of an app's error groups the id of its project error, so the row opens its page", async ({
    expect,
  }) => {
    await report(w, w.web, "cart is undefined");
    await report(w, w.api, "cart is undefined");
    await report(w, w.web, "since deleted");
    const row = await group(w, "cart is undefined");
    // A group outlives its project error: deleted, the row has no page.
    await w.repos.errors.deleteById((await group(w, "since deleted")).id);

    const insights = await w.alepha
      .inject(InsightsController)
      .getInsights.run(
        { params: { projectId: w.projectId }, query: { range: "7d" } },
        { user: w.owner },
      );

    const groups = insights.errorGroups.map((it) => [
      it.message,
      it.sigilLabel,
      it.errorId,
    ]);
    expect(groups).toHaveLength(3);
    expect(groups).toEqual(
      expect.arrayContaining([
        ["cart is undefined", "acme-api/production", row.id],
        ["cart is undefined", "acme/production", row.id],
        ["since deleted", "acme/production", undefined],
      ]),
    );
  });

  it("names no quest where no module registers one, whatever the status says", async ({
    expect,
  }) => {
    await report(w, w.web, "forwarded elsewhere");
    const row = await group(w, "forwarded elsewhere");
    // Ship alone is booted here: Work is off, and the status still points.
    await w.repos.errors.updateById(row.id, { status: "quest:123" });

    const detail = await read(w, row.id);

    expect(detail.error.status).toBe("quest:123");
    expect(detail.quest).toBeUndefined();
  });

  it("names the previous and next open errors in the inbox's order: count, then id", async ({
    expect,
  }) => {
    // Counts 3, 2, 2, 1; the resolved one is out of the walk.
    for (const [message, count] of [
      ["busiest", 3],
      ["tied first", 2],
      ["tied second", 2],
      ["quiet", 1],
      ["resolved", 5],
    ] as const) {
      for (let seen = 0; seen < count; seen++) {
        await report(w, w.web, message);
      }
    }
    const [busiest, first, second, quiet, resolved] = await Promise.all(
      ["busiest", "tied first", "tied second", "quiet", "resolved"].map(
        (message) => group(w, message),
      ),
    );
    await w.controller.resolveProjectError.run(
      { params: { projectId: w.projectId, errorId: resolved!.id } },
      { user: w.owner },
    );

    const walk = async (id: number) => {
      const detail = await read(w, id);
      return [detail.previousId, detail.nextId];
    };
    expect(await walk(busiest!.id)).toEqual([undefined, first!.id]);
    expect(await walk(first!.id)).toEqual([busiest!.id, second!.id]);
    expect(await walk(second!.id)).toEqual([first!.id, quiet!.id]);
    expect(await walk(quiet!.id)).toEqual([second!.id, undefined]);
    // Not open: no neighbour, in either direction.
    expect(await walk(resolved!.id)).toEqual([undefined, undefined]);

    // The list walks them in that same order.
    const list = await w.controller.listProjectErrors.run(
      { params: { projectId: w.projectId }, query: {} },
      { user: w.owner },
    );
    expect(list.items.map((it) => it.id)).toEqual([
      busiest!.id,
      first!.id,
      second!.id,
      quiet!.id,
    ]);
  });

  it("refuses an agent on an untrusted error, and walks it through the trusted ones only", async ({
    expect,
  }) => {
    await report(w, w.web, "untrusted one");
    await report(w, w.web, "trusted one");
    await report(w, w.web, "trusted two");
    const untrusted = await group(w, "untrusted one");
    const one = await group(w, "trusted one");
    const two = await group(w, "trusted two");
    for (const row of [one, two]) {
      await w.controller.trustProjectError.run(
        { params: { projectId: w.projectId, errorId: row.id } },
        { user: w.owner },
      );
    }
    const job = await asJob(w);

    // A refusal, never a redacted row.
    await expect(read(w, untrusted.id, job)).rejects.toThrow(
      "is not trusted yet",
    );
    const detail = await read(w, one.id, job);
    expect(detail.error.message).toBe("trusted one");
    expect([detail.previousId, detail.nextId]).toEqual([undefined, two.id]);
    // A member walks all three.
    expect((await read(w, one.id)).previousId).toBe(untrusted.id);
  });

  it("answers a 404 for an error of another project, and leaves the sibling routes alone", async ({
    expect,
  }) => {
    await report(w, w.web, "mine");
    const mine = await group(w, "mine");
    const other = await createTestProject(w.alepha, {
      createdBy: w.owner.id,
    });

    await expect(
      w.controller.getProjectError.run(
        { params: { projectId: other.id, errorId: mine.id } },
        { user: w.owner },
      ),
    ).rejects.toThrow("Error not found");
    await expect(read(w, 999_999)).rejects.toThrow("Error not found");

    // `/errors/count` and `/errors/rules` are static siblings of
    // `/errors/:errorId`: the new route shadows neither.
    const count = await w.controller.countOpenProjectErrors.fetch(
      { params: { projectId: w.projectId } },
      { user: w.owner },
    );
    expect(count.data).toEqual({ count: 1 });
    const rules = await w.controller.listProjectErrorRules.fetch(
      { params: { projectId: w.projectId } },
      { user: w.owner },
    );
    expect(rules.data).toEqual({ items: [] });
    const viaHttp = await w.controller.getProjectError.fetch(
      { params: { projectId: w.projectId, errorId: mine.id } },
      { user: w.owner },
    );
    expect(viaHttp.data.error.id).toBe(mine.id);
  });
});

/**
 * D1 charges a round trip per statement that waits on another (#E76): the
 * read must not cost one per app or per rule.
 */
describe("getProjectError round trips", () => {
  it("reads an error with many apps and rules in the trips of one app and one rule", async ({
    expect,
  }) => {
    const w = await setup({ trips: true });
    const trips = w.alepha.inject(TripCounter);
    await report(w, w.web, "shared failure", { requestId: "req-9" });
    const row = await group(w, "shared failure");

    // Once before measuring: the gate's project and membership reads are
    // cached for the reads that follow, as they are on a page.
    await read(w, row.id);
    trips.reset();
    await read(w, row.id);
    const few = { trips: trips.trips, statements: trips.statements };
    // The gate's membership read, the row, then every block together.
    expect(trips.chain.map((trip) => trip.length)).toEqual([1, 1, 6]);

    for (let index = 0; index < 6; index++) {
      const sigil = await w.repos.sigils.create({
        projectId: w.projectId,
        name: `app-${index}/production`,
        tokenHash: `hash-many-${index}`,
        tokenPrefix: "sg_many",
        kinds: ["errors"],
      });
      await report(w, sigil, "shared failure", { requestId: "req-9" });
      await w.repos.rules.create({
        projectId: w.projectId,
        pattern: `shared ${index}`,
        createdBy: w.owner.id,
      });
    }
    trips.reset();
    const detail = await read(w, row.id);

    expect(detail.apps).toHaveLength(7);
    expect({ trips: trips.trips, statements: trips.statements }).toEqual(few);
    await w.alepha.stop();
  });
});
