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
import { UptimeErrorService } from "../src/api/services/UptimeErrorService.ts";
import {
  projectErrorEvents,
  projectErrors,
  type Sigil,
  sigils,
} from "../src/schemas/index.ts";
import { createTestProject, DeployTestEntities } from "../src/testing/index.ts";

class Repos {
  sigils = $repository(sigils);
  errors = $repository(projectErrors);
  events = $repository(projectErrorEvents);
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
  const uptime = alepha.inject(UptimeErrorService);
  const dateTime = alepha.inject(DateTimeProvider);
  await alepha.start();
  const created = await entities.users.create({});
  const owner: UserAccountToken = { id: created.id, roles: ["user"] };
  const project = await createTestProject(alepha, { createdBy: owner.id });
  const sigil: Sigil = await repos.sigils.create({
    projectId: project.id,
    name: "acme/production",
    tokenHash: "hash-seen",
    tokenPrefix: "sg_seen",
    kinds: ["errors"],
  });
  return {
    alepha,
    entities,
    repos,
    runs,
    uptime,
    dateTime,
    owner,
    projectId: project.id,
    sigil,
    errors: alepha.inject(ProjectErrorController),
    ingest: alepha.inject(SigilIngestService),
  };
};

type World = Awaited<ReturnType<typeof setup>>;

const report = (
  w: World,
  message: string,
  origin: "client" | "server" = "server",
) =>
  w.ingest.absorb(w.sigil, {
    errors: [
      {
        name: "TypeError",
        message,
        stack: `TypeError: ${message}\n    at ${message.replace(/\s+/g, "_")} (app.js:12:3)`,
        sourceUrl: "https://acme.example/cart",
        origin,
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

const at = (w: World, errorId: number) => ({
  params: { projectId: w.projectId, errorId },
});

const outage = (
  w: World,
  monitorId: string,
  kind: "opened" | "closed",
  when: string,
) =>
  w.uptime.handle({
    kind,
    monitor: {
      id: monitorId,
      projectId: w.projectId,
      name: "Home",
      target: "https://acme.example/",
      statusSince: when,
    },
    incident: {
      cause: "status",
      lastError: "HTTP 500",
      startedAt: when,
      ...(kind === "closed" ? { endedAt: when } : {}),
    },
  } as never);

const resolve = (w: World, errorId: number) =>
  w.errors.resolveProjectError.run(at(w, errorId), { user: w.owner });

const listed = async (w: World, errorId: number) => {
  const { items } = await w.errors.listProjectErrors.run(
    { params: { projectId: w.projectId }, query: { includeResolved: true } },
    { user: w.owner },
  );
  const item = items.find((candidate) => candidate.id === errorId);
  if (!item) throw new Error(`error ${errorId} is not listed`);
  return item;
};

const single = async (w: World, errorId: number) =>
  (await w.errors.getProjectError.run(at(w, errorId), { user: w.owner })).error;

const later = (w: World) => w.dateTime.travel([1, "minute"]);

/**
 * "Seen again since resolved" (#Q4466): a resolved error an app reports
 * again stays resolved and says so, from `resolvedAt` and `lastSeenAt` on
 * its row. A run error and an uptime error reopen by themselves instead.
 */
describe("an error seen again since it was resolved", () => {
  let w: World;
  beforeEach(async () => {
    w = await setup();
  });
  afterEach(async () => {
    await w.alepha.stop();
  });

  it("marks a resolved error its app reports again, in the list and in the single read, and leaves it resolved", async ({
    expect,
  }) => {
    await report(w, "cart is empty");
    const row = await group(w, "cart is empty");
    await resolve(w, row.id);
    await later(w);
    await report(w, "cart is empty");

    const fromList = await listed(w, row.id);
    expect(fromList.status).toBe("resolved");
    expect(fromList.seenAgain).toBe(true);
    expect(fromList.resolvedAt).toBeTruthy();
    const fromRead = await single(w, row.id);
    expect(fromRead.seenAgain).toBe(true);
    expect(fromRead.resolvedAt).toBe(fromList.resolvedAt);
  });

  it("puts no mark on an error resolved and silent since", async ({
    expect,
  }) => {
    await report(w, "cart is empty");
    const row = await group(w, "cart is empty");
    await later(w);
    await resolve(w, row.id);

    const fromList = await listed(w, row.id);
    expect(fromList.resolvedAt).toBeTruthy();
    expect(fromList.seenAgain).toBeUndefined();
    expect((await single(w, row.id)).seenAgain).toBeUndefined();
  });

  it("puts no mark on an open error, nor on one resolved before the date was kept", async ({
    expect,
  }) => {
    await report(w, "still open");
    const open = await group(w, "still open");
    expect((await listed(w, open.id)).seenAgain).toBeUndefined();

    // A row resolved before the column existed: no date, so no guess.
    await report(w, "resolved long ago");
    const old = await group(w, "resolved long ago");
    await w.repos.errors.updateById(old.id, { status: "resolved" });
    await later(w);
    await report(w, "resolved long ago");
    const item = await listed(w, old.id);
    expect(item.resolvedAt).toBeUndefined();
    expect(item.seenAgain).toBeUndefined();
  });

  it("resolving a seen-again error answers the report: the date moves, the mark goes, the thread says so; resolving a silent one changes nothing", async ({
    expect,
  }) => {
    await report(w, "cart is empty");
    const row = await group(w, "cart is empty");
    await resolve(w, row.id);
    const first = (await listed(w, row.id)).resolvedAt;

    // Silent since: a second resolve keeps the date and writes no line.
    await later(w);
    await resolve(w, row.id);
    expect((await listed(w, row.id)).resolvedAt).toBe(first);
    expect(await w.repos.events.count()).toBe(1);

    await later(w);
    await report(w, "cart is empty");
    expect((await listed(w, row.id)).seenAgain).toBe(true);
    await later(w);
    await resolve(w, row.id);
    const item = await listed(w, row.id);
    expect(item.seenAgain).toBeUndefined();
    expect(item.resolvedAt).not.toBe(first);
    expect(await w.repos.events.count()).toBe(2);
  });

  it("a run error resolved by a passing run carries the date and no mark, and loses the date when a failing run reopens it", async ({
    expect,
  }) => {
    const fail = (useCaseRunId: number) =>
      w.runs.failed({
        projectId: w.projectId,
        useCaseId: 9,
        useCaseRunId,
        criterionKey: "C2",
        name: "CriterionFailed",
        message: "The cart keeps its items",
        stack: "Expected 2 items, found 0",
        at: w.dateTime.nowISOString(),
      });
    await fail(1);
    const row = await group(w, "The cart keeps its items");
    await later(w);
    await w.runs.passed({
      projectId: w.projectId,
      useCaseId: 9,
      criterionKey: "C2",
      at: w.dateTime.nowISOString(),
    });
    const resolved = await listed(w, row.id);
    expect(resolved.status).toBe("resolved");
    expect(resolved.resolvedAt).toBeTruthy();
    expect(resolved.seenAgain).toBeUndefined();

    await later(w);
    await fail(2);
    const reopened = await listed(w, row.id);
    expect(reopened.status).toBe("open");
    expect(reopened.resolvedAt).toBeUndefined();
    expect(reopened.seenAgain).toBeUndefined();
  });

  it("an uptime error resolved by a recovery carries the date and no mark, and loses the date when the next outage reopens it", async ({
    expect,
  }) => {
    const monitorId = crypto.randomUUID();
    await outage(w, monitorId, "opened", w.dateTime.nowISOString());
    const [row] = await w.repos.errors.findMany({
      where: { name: { eq: "UptimeOutage" } },
    });
    await later(w);
    await outage(w, monitorId, "closed", w.dateTime.nowISOString());
    const resolved = await listed(w, row!.id);
    expect(resolved.status).toBe("resolved");
    expect(resolved.resolvedAt).toBeTruthy();
    expect(resolved.seenAgain).toBeUndefined();

    await later(w);
    await outage(w, monitorId, "opened", w.dateTime.nowISOString());
    const reopened = await listed(w, row!.id);
    expect(reopened.status).toBe("open");
    expect(reopened.resolvedAt).toBeUndefined();
  });
});
