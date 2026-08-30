import { $hook, Alepha } from "alepha";
import { AlephaApiUsers } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { AlephaOrm } from "alepha/orm";
import {
  AlephaSecurity,
  JwtProvider,
  SecurityProvider,
  type UserAccountToken,
} from "alepha/security";
import { AlephaServer, ServerProvider } from "alepha/server";
import { afterEach, beforeEach, describe, it } from "vitest";

import type { Project } from "../src/api/entities/projects.ts";
import { LoreApi } from "../src/api/index.ts";
import {
  createTestMember,
  createTestProject,
  TestEntityRepositories,
} from "./fixtures/entities.ts";

/**
 * The number the epic exists for.
 *
 * One project navigation coalesces into a single `POST /api/_batch`, and
 * every entry used to resolve the same `(user, project)` pair independently.
 * Nothing else in the pipeline measures that, so without this file the whole
 * thing can ship green having changed the count not at all.
 *
 * Both batches below run against the SAME app, in the same request shape.
 * One is made of ported endpoints, the other of endpoints that still call
 * `ProjectSecurityService.assertMember` in their handler - so the comparison
 * is measured here rather than quoted from a design note.
 */

/**
 * Counts reads that actually reach the database.
 *
 * `repository:read:before` fires **after** the ORM's cache check, so a read
 * served from the 30s project cache is not counted - which is what makes
 * this a query counter and not a call counter. It also fires per repository
 * read rather than per guard, and that distinction is the whole point: seven
 * guards each finding a memoized promise is the PASS condition, so a counter
 * wired to the guard reads seven whether the memo works or not.
 */
class ReadCounter {
  public readonly byTable = new Map<string, number>();

  protected readonly onRead = $hook({
    on: "repository:read:before",
    handler: ({ tableName }) => {
      this.byTable.set(tableName, (this.byTable.get(tableName) ?? 0) + 1);
    },
  });

  public reset(): void {
    this.byTable.clear();
  }

  public of(tableName: string): number {
    return this.byTable.get(tableName) ?? 0;
  }
}

interface TestContext {
  alepha: Alepha;
  repos: TestEntityRepositories;
  counter: ReadCounter;
}

/**
 * Pinned `DATABASE_URL`, like every other lore spec: the ROOT vitest config
 * points it at Postgres, which this app's SQLite provider refuses outright.
 */
const setup = async (): Promise<TestContext> => {
  const alepha = Alepha.create({
    env: { LOG_LEVEL: "error", DATABASE_URL: ":memory:" },
  });

  alepha.with(AlephaOrm);
  alepha.with(AlephaServer);
  alepha.with(AlephaSecurity);
  alepha.with(AlephaEmail);
  alepha.with(AlephaApiUsers);
  alepha.with(LoreApi);
  alepha.with(ReadCounter);

  const repos = alepha.inject(TestEntityRepositories);
  const counter = alepha.inject(ReadCounter);

  await alepha.start();

  return { alepha, repos, counter };
};

/**
 * A real bearer token for a real user, minted the same way `$action.fetch()`
 * mints one in tests - the batch endpoint takes one HTTP request for seven
 * actions, so `.fetch()` per action would defeat the purpose.
 */
const bearer = async (
  ctx: TestContext,
  user: UserAccountToken,
): Promise<string> => {
  const jwt = ctx.alepha.inject(JwtProvider);
  const realm = ctx.alepha.inject(SecurityProvider).getRealms()[0]?.name;
  return jwt.create({ sub: user.id, roles: user.roles }, realm, {
    header: { typ: jwt.accessTokenTyp },
  });
};

const batch = async (
  ctx: TestContext,
  token: string,
  entries: Array<{ action: string; params?: unknown; query?: unknown }>,
): Promise<Array<{ action: string; status: number; error?: string }>> => {
  const res = await fetch(
    `${ctx.alepha.inject(ServerProvider).hostname}/api/_batch`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(entries),
    },
  );
  return await res.json();
};

const memberOf = async (
  ctx: TestContext,
  project: Project,
): Promise<UserAccountToken> => {
  const user = await ctx.repos.users.create({});
  await createTestMember(ctx.alepha, project, user.id, { owner: false });
  // A MEMBER, not the creator: the owner short-circuits before the
  // membership query ever happens, so measuring with the creator would
  // report one read that was never going to be seven.
  return { id: user.id, roles: ["user"] };
};

/**
 * Seven ported endpoints, all `params.projectId`, all reachable with nothing
 * seeded but a project and a membership.
 */
const PORTED = [
  "getQuests",
  "countOpenQuests",
  "getEpics",
  "countPlannedEpics",
  "getReleases",
  // Replaced `getReleaseBacklog`, deleted with the release recorder. Any
  // ported `params.projectId` action reachable with nothing seeded does the
  // job; what is measured is the gate, not this endpoint.
  "listContents",
  "listAllDirectories",
];

/**
 * Seven endpoints still gating inside their handler, kept as the control.
 * `getReports*` take `params.id` rather than `params.projectId`.
 */
const UNPORTED: Array<{ action: string; key: "projectId" | "id" }> = [
  { action: "getAreas", key: "projectId" },
  { action: "getBoard", key: "projectId" },
  { action: "listBlights", key: "projectId" },
  { action: "countOpenBlights", key: "projectId" },
  { action: "getReportsOverview", key: "id" },
  { action: "getReportsQuests", key: "id" },
  { action: "getReportsMembers", key: "id" },
];

describe("$ownsProject, measured", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setup();
  });

  afterEach(async () => {
    await ctx.alepha.stop();
  });

  it("resolves the caller ONCE across a seven-action batch", async ({
    expect,
  }) => {
    const project = await createTestProject(ctx.alepha);
    const user = await memberOf(ctx, project);
    const token = await bearer(ctx, user);

    ctx.counter.reset();
    const results = await batch(
      ctx,
      token,
      PORTED.map((action) => ({
        action,
        params: { projectId: project.id },
        query: {},
      })),
    );

    // Every entry has to have SUCCEEDED. Seven 403s would also resolve the
    // pair once, which is the reading of this number nobody wants.
    expect(results.map((r) => `${r.action}:${r.status}`)).toEqual(
      PORTED.map((action) => `${action}:200`),
    );

    // Exact, never `toBeLessThan`: an upper bound passes just as happily
    // when a later change removes the gate altogether, which is the one
    // failure this epic must never cause.
    expect({
      projects: ctx.counter.of("projects"),
      members: ctx.counter.of("members"),
    }).toEqual({ projects: 1, members: 1 });
  });

  it("still resolves it once per entry where the handler gates itself", async ({
    expect,
  }) => {
    const project = await createTestProject(ctx.alepha);
    const user = await memberOf(ctx, project);
    const token = await bearer(ctx, user);

    ctx.counter.reset();
    const results = await batch(
      ctx,
      token,
      UNPORTED.map(({ action, key }) => ({
        action,
        params: { [key]: project.id },
        query: {},
      })),
    );

    expect(results.map((r) => r.status)).toEqual([
      200, 200, 200, 200, 200, 200, 200,
    ]);

    // The control, and the before-figure for the epic's claim: FOURTEEN
    // reads where the ported batch takes two.
    //
    // `projects` is 7 and not 1, which is worth stating because the obvious
    // guess is otherwise: `assertMember` reads that row through the ORM's
    // 30s cache, so it looks as though six of the seven should hit it. They
    // do not. A batch runs its entries CONCURRENTLY, and the cache is
    // populated when a read resolves - so all seven miss before any of them
    // fills it. Inside one batch the TTL saves nothing at all.
    //
    // That is the difference the epic named between the two mechanisms, and
    // this is where it is visible: the memo caches the in-flight PROMISE, so
    // six entries await the first one's query; a TTL cache can only help a
    // LATER request.
    expect({
      projects: ctx.counter.of("projects"),
      members: ctx.counter.of("members"),
    }).toEqual({ projects: 7, members: 7 });
  });

  it("does not carry the resolution into the next request", async ({
    expect,
  }) => {
    const project = await createTestProject(ctx.alepha);
    const user = await memberOf(ctx, project);
    const token = await bearer(ctx, user);

    const entries = PORTED.map((action) => ({
      action,
      params: { projectId: project.id },
      query: {},
    }));

    ctx.counter.reset();
    await batch(ctx, token, entries);
    await batch(ctx, token, entries);

    // Two requests, two membership reads. A memo that outlived its request
    // would read once and keep answering - including for a membership
    // revoked in between, which is exactly the property the 30s project
    // cache is allowed to lose and this one is not.
    expect(ctx.counter.of("members")).toBe(2);
  });
});
