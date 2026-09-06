import { $inject, Alepha, z } from "alepha";
import { AlephaApiUsers } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { AlephaOrm } from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import { $route, AlephaServer, ServerProvider } from "alepha/server";
import { afterEach, beforeEach, describe, it } from "vitest";

import { LoreApi } from "@/api/index.ts";
import { CapabilityRegistry } from "@/api/services/CapabilityRegistry.ts";
import { ProjectSecurityService } from "@/api/services/ProjectSecurityService.ts";

import {
  createTestProject,
  TestEntityRepositories,
} from "./fixtures/entities.ts";
import { ReadCounter } from "./fixtures/ReadCounter.ts";

/**
 * The capability read path: the query, its window, and its request memo.
 *
 * The number this file exists for is the last one. A page that opens a
 * project sends ONE `POST /api/_batch`, and every entry in it gates
 * independently — so a capability read added to that gate is added seven
 * times unless something makes the entries share it. Nothing else in the
 * pipeline measures that, and a build that pays seven D1 calls where it
 * should pay one is green everywhere: the answers are identical, only the
 * bill differs.
 *
 * ⚠️ The 30 s TTL does **not** produce this number, and the difference is
 * worth stating because the obvious guess is otherwise. A batch runs its
 * entries CONCURRENTLY, so all seven miss the cache before any of them fills
 * it; a TTL can only help a LATER request. The memo stores the in-flight
 * PROMISE, which is what makes six of them await the first one's query.
 *
 * The probe route below is the harness, not the subject: it exists so seven
 * concurrent gates happen inside one real HTTP request, with the real
 * `server:onRequest` hook seeding the real memo. Reaching the same shape by
 * seeding a `Map` by hand would prove the `Map` and not the wiring — and the
 * wiring is exactly where this fails, since a memo created lazily inside a
 * gate lands in that action's own ALS fork and is invisible to its siblings.
 */
class CapabilityProbe {
  protected readonly security = $inject(ProjectSecurityService);

  /**
   * Seven concurrent `capabilitiesOf` calls, the shape a seven-entry batch
   * produces once every gate reads capabilities.
   */
  probe = $route({
    path: "/probe/capabilities/:projectId",
    schema: { response: z.record(z.text(), z.any()) },
    handler: async ({ params }) => {
      const id = Number(params.projectId);
      const sets = await Promise.all(
        Array.from({ length: 7 }, () => this.security.capabilitiesOf(id)),
      );
      return { keys: sets.map((set) => Object.keys(set).sort()) } as any;
    },
  });
}

interface TestContext {
  alepha: Alepha;
  repos: TestEntityRepositories;
  counter: ReadCounter;
  security: ProjectSecurityService;
  registry: CapabilityRegistry;
}

/**
 * Pinned `DATABASE_URL`, like every other lore spec: the ROOT vitest config
 * points it at Postgres, which this app's SQLite provider refuses outright.
 */
const setup = async (): Promise<TestContext> => {
  const alepha = Alepha.create({
    env: { LOG_LEVEL: "error", SERVER_PORT: 0, DATABASE_URL: ":memory:" },
  });

  alepha.with(AlephaOrm);
  alepha.with(AlephaServer);
  alepha.with(AlephaSecurity);
  alepha.with(AlephaEmail);
  alepha.with(AlephaApiUsers);
  alepha.with(LoreApi);
  alepha.with(ReadCounter);
  alepha.with(CapabilityProbe);

  const repos = alepha.inject(TestEntityRepositories);
  const counter = alepha.inject(ReadCounter);
  const security = alepha.inject(ProjectSecurityService);
  const registry = alepha.inject(CapabilityRegistry);

  await alepha.start();

  return { alepha, repos, counter, security, registry };
};

describe("CapabilityRegistry", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setup();
  });

  afterEach(async () => {
    await ctx.alepha.stop();
  });

  it("declares all four capabilities, in wizard order", ({ expect }) => {
    expect(ctx.registry.all().map((c) => c.key)).toEqual([
      "work",
      "knowledge",
      "apps",
      "support",
    ]);
    // The enum is the list, so a key without a descriptor cannot hide.
    expect(ctx.registry.keys()).toEqual(ctx.registry.all().map((c) => c.key));
  });

  it("reads an absent option as false, whatever the option", ({ expect }) => {
    // The read rule of the whole epic. A row written before an option existed
    // never said anything about it, and every optional key in
    // `projects.features` is absent on every project that predates it.
    expect(ctx.registry.optionsOf("work", {})).toEqual({
      board: false,
      epics: false,
      releases: false,
      estimate: false,
      chrono: false,
      reminder: false,
    });
    expect(ctx.registry.optionsOf("apps", { track: true })).toEqual({
      track: true,
      deploy: false,
    });
    expect(ctx.registry.optionsOf("support", {})).toEqual({});
  });

  it("strips an unknown option on the way out, refuses it on the way in", ({
    expect,
  }) => {
    // Out: a row written by a build with one option more than this one still
    // has to load. Throwing here is the 2026-08-05 failure mode.
    expect(
      ctx.registry.optionsOf("apps", { track: true, futureThing: true }),
    ).toEqual({ track: true, deploy: false });

    // In: `createProject`'s body is `.partial()`, so a mistyped feature key
    // has been accepted silently for as long as the bag has existed. This is
    // the one place a typo can be caught.
    expect(() =>
      ctx.registry.strictOptionsOf("apps", { trakc: true }),
    ).toThrow();
  });

  it("preselects only apps.track", ({ expect }) => {
    // Board and Releases were on by default before this epic. A board is a
    // way to look at quests, not a reason to have them; the same argument
    // applied consistently takes Releases with it. Apps keeps its one,
    // because the capability's own label says "watch".
    expect(ctx.registry.preselectedOptionsOf("work")).toEqual({
      board: false,
      epics: false,
      releases: false,
      estimate: false,
      chrono: false,
      reminder: false,
    });
    expect(ctx.registry.preselectedOptionsOf("apps")).toEqual({
      track: true,
      deploy: false,
    });
  });

  it("names the capability that owns a tool, and nothing for a core tool", ({
    expect,
  }) => {
    expect(ctx.registry.ownerOfTool("quest_create")).toBe("work");
    expect(ctx.registry.ownerOfTool("folio_get")).toBe("knowledge");
    expect(ctx.registry.ownerOfTool("blight_forward")).toBe("apps");
    expect(ctx.registry.ownerOfTool("feedback_accept")).toBe("support");
    // Core. A project with no capabilities at all is a legal state and still
    // has to be readable.
    expect(ctx.registry.ownerOfTool("project_context")).toBeUndefined();
  });

  it("gives every tool, card, search kind and permission group one owner", ({
    expect,
  }) => {
    // Two capabilities claiming one surface is a silent bug: whichever is
    // declared first wins `ownerOfTool`, and the other's gate never runs.
    for (const field of [
      "mcpTools",
      "searchKinds",
      "activityKinds",
      "dashboardCards",
      "permissionGroups",
    ] as const) {
      const all = ctx.registry.all().flatMap((c) => c[field]);
      expect(new Set(all).size, `${field} has a duplicate`).toBe(all.length);
    }
  });
});

describe("ProjectSecurityService.capabilitiesOf", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setup();
  });

  afterEach(async () => {
    await ctx.alepha.stop();
  });

  it("answers {} for a project with no rows", async ({ expect }) => {
    // Explicitly none: the fixture defaults to all four, so a spec whose
    // subject is the empty state has to say so.
    const project = await createTestProject(ctx.alepha, { capabilities: [] });

    // Not an error and not a default set. Every capability may be turned off,
    // the last one included, and a project with none must still work — that
    // is the test that the modularity is real.
    expect(await ctx.security.capabilitiesOf(project.id)).toEqual({});
  });

  it("reads a row as on, with its options defaulted", async ({ expect }) => {
    const project = await createTestProject(ctx.alepha, {
      capabilities: [{ key: "work", options: { board: true } }],
    });

    const set = await ctx.security.capabilitiesOf(project.id);
    expect(ctx.security.hasCapability(set, "work")).toBe(true);
    expect(ctx.security.hasCapability(set, "apps")).toBe(false);
    expect(ctx.security.capabilityOption(set, "work", "board")).toBe(true);
    expect(ctx.security.capabilityOption(set, "work", "epics")).toBe(false);
    // An option of a capability that is OFF is off, whatever it says. That is
    // the one rule about capabilities reading each other: narrow, never widen.
    expect(ctx.security.capabilityOption(set, "apps", "track")).toBe(false);
  });

  it("makes seven concurrent gates in one request pay one query", async ({
    expect,
  }) => {
    const project = await createTestProject(ctx.alepha, {
      capabilities: [{ key: "knowledge", options: {} }],
    });

    ctx.counter.reset();
    const res = await fetch(
      `${ctx.alepha.inject(ServerProvider).hostname}/probe/capabilities/${project.id}`,
    );
    const body = (await res.json()) as { keys: string[][] };

    // All seven must have ANSWERED. Seven failures also read the table once,
    // which is the reading of this number nobody wants.
    expect(res.status).toBe(200);
    expect(body.keys).toEqual(Array.from({ length: 7 }, () => ["knowledge"]));

    // Exact, never `toBeLessThan`: an upper bound stays green when a later
    // change drops the read altogether.
    expect(ctx.counter.of("project_capabilities")).toBe(1);
  });

  it("serves a later request from the 30 s window", async ({ expect }) => {
    const project = await createTestProject(ctx.alepha, { capabilities: [] });
    const url = `${ctx.alepha.inject(ServerProvider).hostname}/probe/capabilities/${project.id}`;

    ctx.counter.reset();
    await fetch(url);
    await fetch(url);

    // The second layer, and the one the memo cannot provide: a memo dies with
    // its request, so without the TTL the next page load pays again.
    // Capabilities are configuration, exactly what `features.*` was, so they
    // take the project row's window rather than membership's — membership is
    // revocable and is deliberately never cached at all.
    expect(ctx.counter.of("project_capabilities")).toBe(1);
  });

  it("shows a write made in this process at once, window or not", async ({
    expect,
  }) => {
    const project = await createTestProject(ctx.alepha, { capabilities: [] });
    const url = `${ctx.alepha.inject(ServerProvider).hostname}/probe/capabilities/${project.id}`;

    const before = (await (await fetch(url)).json()) as { keys: string[][] };
    expect(before.keys[0]).toEqual([]);

    await ctx.security.capabilities.create({
      projectId: project.id,
      key: "apps",
      options: { track: true },
    });

    const after = (await (await fetch(url)).json()) as { keys: string[][] };

    // `Repository` invalidates the table on every mutation, so the window
    // only ever applies to a write made by ANOTHER isolate. Without this the
    // settings page would show a switch that does not appear to take, for up
    // to half a minute, on the machine that flipped it.
    expect(after.keys[0]).toEqual(["apps"]);
  });
});
