import { ProjectSecurityService } from "@lore/core/api";
import { comments, jobKeys } from "@lore/core/schemas";
import { Alepha } from "alepha";
import { RankService } from "alepha/api/organizations";
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
  ProjectErrorThreadController,
  SigilIngestService,
} from "../src/api/index.ts";
import { ProjectErrorJobs } from "../src/api/jobs/ProjectErrorJobs.ts";
import { RunErrorService } from "../src/api/services/RunErrorService.ts";
import { UptimeErrorService } from "../src/api/services/UptimeErrorService.ts";
import {
  projectErrorEvents,
  projectErrors,
  type Sigil,
  sigils,
} from "../src/schemas/index.ts";
import {
  createTestMemberByProjectId,
  createTestProject,
  DeployTestEntities,
} from "../src/testing/index.ts";

class Repos {
  sigils = $repository(sigils);
  errors = $repository(projectErrors);
  events = $repository(projectErrorEvents);
  comments = $repository(comments);
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
  const uptime = alepha.inject(UptimeErrorService);
  const jobs = alepha.inject(ProjectErrorJobs);
  const dateTime = alepha.inject(DateTimeProvider);
  await alepha.start();
  const created = await entities.users.create({});
  const owner: UserAccountToken = { id: created.id, roles: ["user"] };
  const project = await createTestProject(alepha, { createdBy: owner.id });
  const sigil: Sigil = await repos.sigils.create({
    projectId: project.id,
    name: "acme/production",
    tokenHash: "hash-thread",
    tokenPrefix: "sg_thread",
    kinds: ["errors"],
  });
  return {
    alepha,
    entities,
    repos,
    runs,
    uptime,
    jobs,
    dateTime,
    owner,
    projectId: project.id,
    sigil,
    errors: alepha.inject(ProjectErrorController),
    thread: alepha.inject(ProjectErrorThreadController),
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

const read = async (
  w: World,
  errorId: number,
  user: UserAccountToken = w.owner,
) =>
  (await w.thread.listProjectErrorThread.run(at(w, errorId), { user })).entries;

const say = (
  w: World,
  errorId: number,
  body: string,
  user: UserAccountToken = w.owner,
  source?: { kind: "mcp" | "cli"; client?: string },
) =>
  w.thread.createProjectErrorComment.run(
    { ...at(w, errorId), body: { body, ...(source ? { source } : {}) } },
    { user },
  );

/**
 * What the thread says changed, in order: each event's kind and whether a
 * member did it.
 */
const events = async (w: World, errorId: number) =>
  (await read(w, errorId))
    .filter((entry) => entry.type === "event")
    .map((entry) => [entry.kind, entry.userId ?? null]);

/**
 * The caller an agent's job key makes (#Q3995).
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

/**
 * An error's thread (#E185): comments on core's `comments`, and one event
 * per change of triage state, a member's or Lore's own. Booted with Ship
 * alone; the forward, the link and the hand back need Plan and are in
 * `apps/lore/test/error-thread.spec.ts`.
 */
describe("an error's thread", () => {
  let w: World;
  beforeEach(async () => {
    w = await setup();
  });
  afterEach(async () => {
    await w.alepha.stop();
  });

  it("round-trips a comment through core's table: add, list, edit, delete", async ({
    expect,
  }) => {
    await report(w, "cart failed");
    const row = await group(w, "cart failed");

    const written = await say(w, row.id, "Is this the **deploy** of Monday?");
    expect(written).toMatchObject({
      type: "comment",
      userId: w.owner.id,
      body: "Is this the **deploy** of Monday?",
    });
    expect(written.editedAt).toBeUndefined();
    // On core's table, under the `error` subject and the error's project.
    expect(await w.repos.comments.findMany()).toMatchObject([
      {
        id: written.id,
        projectId: w.projectId,
        subjectType: "error",
        subjectId: row.id,
        authorId: w.owner.id,
      },
    ]);

    const edited = await w.thread.updateProjectErrorComment.run(
      {
        params: {
          projectId: w.projectId,
          errorId: row.id,
          commentId: written.id,
        },
        body: { body: "It is." },
      },
      { user: w.owner },
    );
    expect(edited.body).toBe("It is.");
    expect(edited.editedAt).toBeTruthy();
    expect((await read(w, row.id)).map((entry) => entry.body)).toEqual([
      "It is.",
    ]);

    await w.thread.deleteProjectErrorComment.run(
      {
        params: {
          projectId: w.projectId,
          errorId: row.id,
          commentId: written.id,
        },
      },
      { user: w.owner },
    );
    expect(await read(w, row.id)).toEqual([]);
    expect(await w.repos.comments.count()).toBe(0);
  });

  it("names a member as the other threads do: first and last name, else the handle", async ({
    expect,
  }) => {
    await report(w, "named");
    const row = await group(w, "named");
    const named = await w.entities.users.create({
      firstName: "ada",
      lastName: "lovelace",
      username: "ada",
    } as never);
    const handle = await w.entities.users.create({
      username: "grace",
    } as never);
    for (const user of [named, handle]) {
      await createTestMemberByProjectId(w.alepha, w.projectId, user.id);
      await say(w, row.id, "Seen it too.", { id: user.id, roles: ["user"] });
    }

    const names = (await read(w, row.id)).map((entry) => entry.userName);
    expect(names).toEqual(["Ada Lovelace", "grace"]);
  });

  it("lets a member holding only error:read comment, and keeps every triage verb from them", async ({
    expect,
  }) => {
    await report(w, "cart failed");
    const row = await group(w, "cart failed");
    const created = await w.entities.users.create({});
    const reader: UserAccountToken = { id: created.id, roles: ["user"] };
    await w.alepha.inject(RankService).save(
      await w.alepha
        .inject(ProjectSecurityService)
        .organizationIdOf(w.projectId),
      {
        key: "error-reader",
        name: "Error reader",
        permissions: ["project:read", "error:read"],
      },
      w.owner,
    );
    await createTestMemberByProjectId(w.alepha, w.projectId, reader.id, {
      rank: "error-reader",
    });

    const mine = await say(w, row.id, "Seen on staging too.", reader);
    const theirs = await say(w, row.id, "Thanks.");

    expect((await read(w, row.id, reader)).map((entry) => entry.body)).toEqual([
      "Seen on staging too.",
      "Thanks.",
    ]);
    await expect(
      w.errors.resolveProjectError.run(at(w, row.id), { user: reader }),
    ).rejects.toThrow();
    // Their own words, and nobody else's.
    await expect(
      w.thread.deleteProjectErrorComment.run(
        {
          params: {
            projectId: w.projectId,
            errorId: row.id,
            commentId: theirs.id,
          },
        },
        { user: reader },
      ),
    ).rejects.toThrow("Only the author");
    await expect(
      w.thread.updateProjectErrorComment.run(
        {
          params: {
            projectId: w.projectId,
            errorId: row.id,
            commentId: mine.id,
          },
          body: { body: "Rewritten by the owner" },
        },
        { user: w.owner },
      ),
    ).rejects.toThrow("Only the author");
  });

  it("refuses a comment of another error or of another project, with a 404", async ({
    expect,
  }) => {
    await report(w, "first");
    await report(w, "second");
    const first = await group(w, "first");
    const second = await group(w, "second");
    const comment = await say(w, first.id, "On the first");
    const other = await createTestProject(w.alepha, { createdBy: w.owner.id });

    await expect(
      w.thread.deleteProjectErrorComment.run(
        {
          params: {
            projectId: w.projectId,
            errorId: second.id,
            commentId: comment.id,
          },
        },
        { user: w.owner },
      ),
    ).rejects.toThrow("Comment not found");
    await expect(
      w.thread.listProjectErrorThread.run(
        { params: { projectId: other.id, errorId: first.id } },
        { user: w.owner },
      ),
    ).rejects.toThrow("Error not found");
    await expect(
      w.thread.createProjectErrorComment.run(
        {
          params: { projectId: other.id, errorId: first.id },
          body: { body: "Across projects" },
        },
        { user: w.owner },
      ),
    ).rejects.toThrow("Error not found");
    expect(await w.repos.comments.count()).toBe(1);
  });

  it("keeps an agent off an untrusted error's thread, and marks what it writes on a trusted one", async ({
    expect,
  }) => {
    await report(w, "from a browser", "client");
    const row = await group(w, "from a browser");
    await say(w, row.id, "A member may write before the trust.");
    const job = await asJob(w);

    await expect(read(w, row.id, job)).rejects.toThrow("is not trusted yet");
    await expect(
      say(w, row.id, "An agent's finding", job, { kind: "mcp" }),
    ).rejects.toThrow("is not trusted yet");

    await w.errors.trustProjectError.run(at(w, row.id), { user: w.owner });
    const finding = await say(w, row.id, "Likely the cart reducer.", job, {
      kind: "mcp",
      client: "claude-code",
    });

    expect(finding.source).toEqual({ kind: "mcp", client: "claude-code" });
    expect(
      (await read(w, row.id, job)).map((entry) => entry.kind ?? entry.body),
    ).toEqual([
      "A member may write before the trust.",
      "trusted",
      "Likely the cart reducer.",
    ]);
  });

  it("records each verb of a member, in order, with who did it", async ({
    expect,
  }) => {
    await report(w, "from a browser", "client");
    const row = await group(w, "from a browser");

    await w.errors.trustProjectError.run(at(w, row.id), { user: w.owner });
    // Trusting a trusted error changes nothing, and leaves no second line.
    await w.errors.trustProjectError.run(at(w, row.id), { user: w.owner });
    await w.errors.untrustProjectError.run(at(w, row.id), { user: w.owner });
    await w.errors.untrustProjectError.run(at(w, row.id), { user: w.owner });
    await w.errors.resolveProjectError.run(at(w, row.id), { user: w.owner });
    await w.errors.resolveProjectError.run(at(w, row.id), { user: w.owner });

    expect(await events(w, row.id)).toEqual([
      ["trusted", w.owner.id],
      ["untrusted", w.owner.id],
      ["resolved", w.owner.id],
    ]);
  });

  it("writes no event for a server error trusted on arrival, nor on any later report", async ({
    expect,
  }) => {
    await report(w, "server side");
    await report(w, "server side");
    const row = await group(w, "server side");

    expect(row.trustedAt).toBeTruthy();
    expect(await w.repos.events.count()).toBe(0);
  });

  it("records what a use case run does by itself: resolved by a pass, reopened by the next failure", async ({
    expect,
  }) => {
    const run = (useCaseRunId: number) =>
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
    const pass = () =>
      w.runs.passed({
        projectId: w.projectId,
        useCaseId: 9,
        criterionKey: "C2",
        at: w.dateTime.nowISOString(),
      });
    await run(1);
    const row = await group(w, "The cart keeps its items");
    // A second failure of an open error reopens nothing.
    await run(2);
    expect(await events(w, row.id)).toEqual([]);

    await pass();
    // Nothing open to resolve: no second line.
    await pass();
    await run(3);

    expect(await events(w, row.id)).toEqual([
      ["run_resolved", null],
      ["run_reopened", null],
    ]);
    expect((await group(w, "The cart keeps its items")).status).toBe("open");
  });

  it("records what a monitor does by itself: resolved by its recovery, reopened by the next outage", async ({
    expect,
  }) => {
    const monitorId = crypto.randomUUID();
    await outage(w, monitorId, "opened", "2026-11-01T10:00:00.000Z");
    const [row] = await w.repos.errors.findMany({
      where: { name: { eq: "UptimeOutage" } },
    });
    expect(await events(w, row!.id)).toEqual([]);

    await outage(w, monitorId, "closed", "2026-11-01T10:05:00.000Z");
    // A recovery delivered twice resolves once.
    await outage(w, monitorId, "closed", "2026-11-01T10:05:00.000Z");
    expect((await w.repos.errors.findById(row!.id))?.status).toBe("resolved");
    await outage(w, monitorId, "opened", "2026-11-02T08:00:00.000Z");

    expect(await events(w, row!.id)).toEqual([
      ["monitor_resolved", null],
      ["monitor_reopened", null],
    ]);
    expect((await w.repos.errors.findById(row!.id))?.status).toBe("open");
  });

  it("keeps a forwarded uptime error's quest through an outage and a recovery", async ({
    expect,
  }) => {
    const monitorId = crypto.randomUUID();
    await outage(w, monitorId, "opened", "2026-11-01T10:00:00.000Z");
    const [row] = await w.repos.errors.findMany({
      where: { name: { eq: "UptimeOutage" } },
    });
    // As a forward leaves it: Plan is not booted here, the status is.
    await w.repos.errors.updateById(row!.id, { status: "quest:77" });

    await outage(w, monitorId, "closed", "2026-11-01T10:05:00.000Z");
    expect((await w.repos.errors.findById(row!.id))?.status).toBe("quest:77");
    await outage(w, monitorId, "opened", "2026-11-02T08:00:00.000Z");
    const after = await w.repos.errors.findById(row!.id);

    expect(after?.status).toBe("quest:77");
    // The outage is still told: the newest incident, not the status.
    expect(after?.lastSeenAt).toBe("2026-11-02T08:00:00.000Z");
    expect(await w.repos.events.count()).toBe(0);
  });

  it("leaves no comment and no event behind a deleted error: single, bulk and the retention purge", async ({
    expect,
  }) => {
    for (const message of ["single", "bulk one", "bulk two", "stale", "kept"]) {
      await report(w, message, "client");
      const row = await group(w, message);
      await say(w, row.id, `About ${message}`);
      await w.errors.trustProjectError.run(at(w, row.id), { user: w.owner });
    }
    const [single, one, two, stale, kept] = await Promise.all(
      ["single", "bulk one", "bulk two", "stale", "kept"].map((message) =>
        group(w, message),
      ),
    );
    expect(await w.repos.comments.count()).toBe(5);
    expect(await w.repos.events.count()).toBe(5);

    await w.errors.deleteProjectError.run(at(w, single!.id), {
      user: w.owner,
    });
    await w.errors.deleteProjectErrors.run(
      {
        params: { projectId: w.projectId },
        body: { ids: [one!.id, two!.id] },
      },
      { user: w.owner },
    );
    // Past the 30 days of the default retention, open, and so purged.
    await w.repos.errors.updateById(stale!.id, {
      lastSeenAt: "2026-01-01T00:00:00.000Z",
    });
    await w.jobs.purgeStaleProjectErrors.run();

    expect((await w.repos.errors.findMany()).map((row) => row.id)).toEqual([
      kept!.id,
    ]);
    expect(
      (await w.repos.comments.findMany()).map((comment) => comment.subjectId),
    ).toEqual([kept!.id]);
    expect(
      (await w.repos.events.findMany()).map((event) => event.projectErrorId),
    ).toEqual([kept!.id]);
  });
});
