import { Alepha, z } from "alepha";
import { RankService } from "alepha/api/ranks";
import { AlephaApiUsers } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { $repository, AlephaOrm } from "alepha/orm";
import {
  $secure,
  AlephaSecurity,
  JwtProvider,
  SecurityProvider,
  type UserAccountToken,
} from "alepha/security";
import {
  $action,
  AlephaServer,
  ForbiddenError,
  ServerProvider,
} from "alepha/server";
import { afterEach, beforeEach, describe, it } from "vitest";

import { members } from "../src/api/entities/members.ts";
import { type Project, projects } from "../src/api/entities/projects.ts";
import { LoreApi } from "../src/api/index.ts";
import {
  createTestMember,
  createTestProject,
  TestEntityRepositories,
} from "./fixtures/entities.ts";
import { ReadCounter } from "./fixtures/ReadCounter.ts";

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
 * `ReadCounter` fires per repository read rather than per guard, and that
 * distinction is the whole point here: seven guards each finding a memoized
 * promise is the PASS condition, so a counter wired to the guard reads seven
 * whether the memo works or not.
 */
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
  alepha.with(InHandlerGateControl);

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
  await createTestMember(ctx.alepha, project, user.id);
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
  "getEpicRefs",
  "getReleases",
  // Replaced `getReleaseBacklog`, deleted with the release recorder. Any
  // ported `params.projectId` action reachable with nothing seeded does the
  // job; what is measured is the gate, not this endpoint.
  "listContents",
  "listAllDirectories",
];

/**
 * The control, and it has to be synthetic now.
 *
 * This list used to name seven real endpoints that still called
 * `assertMember` in their handlers - Areas, the board, Blights, Reports. #Q1955
 * ported the last of them, so there is no in-handler gate left in the
 * application to measure against, and the before-figure would have gone with
 * it. Seven actions declared here reproduce exactly the shape that was
 * removed: same permission, same param, same `assertMember` as the first
 * statement of the handler.
 *
 * Keeping the comparison synthetic is the point. The claim this spec makes is
 * about two MECHANISMS, not about two lists of endpoints, and a claim whose
 * control has been deleted is a number nobody can check.
 */
class InHandlerGateControl {
  protected readonly projects = $repository(projects);
  protected readonly members = $repository(members);

  protected gated() {
    return $action({
      use: [$secure({ permissions: ["project:read"] })],
      schema: {
        params: z.object({ projectId: z.integer() }),
        response: z.object({ ok: z.boolean() }),
      },
      handler: async ({ params, user }) => {
        // Exactly what `ProjectSecurityService.assertMember` did before this
        // epic deleted it: the project row through the ORM's 30 s cache, then
        // the membership row uncached. Reproduced here rather than called,
        // because there is no longer a method to call - which is the point
        // being measured.
        const project = await this.projects.getOne(
          { where: { id: { eq: params.projectId } } },
          { cache: { ttl: 30_000 } },
        );
        const member = await this.members.findOne({
          where: {
            projectId: { eq: project.id },
            userId: { eq: user.id },
          },
        });
        if (!member) {
          throw new ForbiddenError("Not a member of this project");
        }
        return { ok: true };
      },
    });
  }

  controlOne = this.gated();
  controlTwo = this.gated();
  controlThree = this.gated();
  controlFour = this.gated();
  controlFive = this.gated();
  controlSix = this.gated();
  controlSeven = this.gated();
}

const UNPORTED = [
  "controlOne",
  "controlTwo",
  "controlThree",
  "controlFour",
  "controlFive",
  "controlSix",
  "controlSeven",
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
    // Exact, never `toBeLessThan`: an upper bound passes just as happily
    // when a later change removes the gate altogether, which is the one
    // failure this epic must never cause.
    //
    // ⚠️ `rank_definitions: 1` is epic #E39's whole added cost, and it was
    // SEVEN when this line was first written. The TTL cache answers the
    // second REQUEST inside 30 seconds; it cannot answer the second entry of
    // a batch already in flight, because all seven miss before any of them
    // populates it. `RankService.definitionsOf` goes through the request memo
    // as well now, which stores the in-flight promise - see #Q1934.
    //
    // `project_capabilities` is deliberately absent rather than pinned at 0:
    // the fixture writes those rows itself, so the ORM's 30 s cache is warm
    // by the time the batch runs and `ReadCounter` fires after the cache
    // check. Pinning a zero that a fixture produced would be pinning the
    // fixture.
    expect(Object.fromEntries(ctx.counter.byTable)).toMatchObject({
      projects: 1,
      members: 1,
      rank_definitions: 1,
    });
  });

  it("costs the CREATOR the same, which is the epic's real price", async ({
    expect,
  }) => {
    const project = await createTestProject(ctx.alepha);
    const creator = { id: project.createdBy, roles: ["user"] };
    const token = await bearer(ctx, creator);

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

    expect(results.map((r) => r.status)).toEqual([
      200, 200, 200, 200, 200, 200, 200,
    ]);

    // ⚠️ The number this case exists to name. Before epic #E39, `$ownsProject`
    // carried `owner: "createdBy"` and the creator short-circuited BEFORE the
    // membership join: they paid `projects` and nothing else. `createdBy` is
    // not an authorization input any more - it cannot be, once ownership can
    // be transferred - so the creator pays the same two reads everybody else
    // does, plus the definitions.
    //
    // One read, once per request, for a creator who used to pay none: that is
    // the cost, stated rather than estimated.
    expect(Object.fromEntries(ctx.counter.byTable)).toMatchObject({
      projects: 1,
      members: 1,
      rank_definitions: 1,
    });
  });

  it("takes a demotion on the very next request", async ({ expect }) => {
    const project = await createTestProject(ctx.alepha);
    const user = await memberOf(ctx, project);
    const token = await bearer(ctx, user);

    // `member` grants `quest:read`, so this passes.
    const before = await batch(ctx, token, [
      { action: "getQuests", params: { projectId: project.id }, query: {} },
    ]);
    expect(before[0].status).toBe(200);

    // A rank that grants only the floor. Written directly, because what is
    // under test is the READ path's caching, not the write path's rules.
    const row = await ctx.repos.members.findOne({
      where: { projectId: { eq: project.id }, userId: { eq: user.id } },
    });
    await ctx.alepha
      .inject(RankService)
      .save(
        "project",
        String(project.id),
        { key: "walled", name: "Walled", permissions: ["project:read"] },
        { id: project.createdBy, roles: ["user"] },
      );
    await ctx.repos.members.updateById(row!.id, { rank: "walled" });

    // ⚠️ No `travel()`, no waiting out a window. The ASSIGNMENT is never
    // cached - it rides the membership row, which `$owns` reads uncached
    // precisely so a removal takes effect at once - and the DEFINITIONS cache
    // is keyed per scope and invalidated by the write above. A 30 second
    // window on revocation would be the one property this epic must not
    // introduce.
    const after = await batch(ctx, token, [
      { action: "getQuests", params: { projectId: project.id }, query: {} },
    ]);
    expect(after[0].status).toBe(403);
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
      UNPORTED.map((action) => ({
        action,
        params: { projectId: project.id },
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
