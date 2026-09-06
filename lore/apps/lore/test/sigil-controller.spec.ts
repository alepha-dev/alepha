import { sigilKeyProject } from "@alepha/lore/sigil";
import { Alepha, z } from "alepha";
import { AdminUserController, AlephaApiUsers } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { AlephaFake, FakeProvider } from "alepha/fake";
import { $repository, AlephaOrm } from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer, HttpError } from "alepha/server";
import { afterEach, beforeEach, describe, it } from "vitest";

import { AppController } from "../src/api/controllers/AppController.ts";
import { ProjectController } from "../src/api/controllers/ProjectController.ts";
import { SigilController } from "../src/api/controllers/SigilController.ts";
import { members } from "../src/api/entities/members.ts";
import { projects } from "../src/api/entities/projects.ts";
import { sigilViewsHourly } from "../src/api/entities/sigilViewsHourly.ts";
import { LoreApi } from "../src/api/index.ts";
import { SigilTokenService } from "../src/api/services/SigilTokenService.ts";

const adminUser = { id: crypto.randomUUID(), roles: ["admin"] };

const userDataSchema = z.object({
  username: z.string(),
  email: z.email(),
});

/**
 * Direct table access for the two facts the controller does not expose: that a
 * membership exists, and that an app's history survives (or does not).
 */
class Probe {
  members = $repository(members);
  views = $repository(sigilViewsHourly);
  projects = $repository(projects);
}

interface TestContext {
  alepha: Alepha;
  adminUserController: AdminUserController;
  projectController: ProjectController;
  appController: AppController;
  sigilController: SigilController;
  tokens: SigilTokenService;
  probe: Probe;
  fakeProvider: FakeProvider;
}

/**
 * A token service that mints one token, forever.
 *
 * Substituted in to force the one unique index on `sigils` a caller can still
 * reach: `tokenHash`. Since Apps v3 the other, `(projectId, name)`, cannot be
 * violated at all - the name is the `"<app>/<env>"` mirror and the pair is
 * itself unique - which is why the handler's conflict branch has exactly one
 * meaning now.
 */
class FixedTokenService extends SigilTokenService {
  override async mint(): Promise<{
    token: string;
    hash: string;
    prefix: string;
  }> {
    return { token: "sg_fixed_x", hash: "fixed-hash", prefix: "sg_fixed_x" };
  }
}

const setup = async (
  configure?: (alepha: Alepha) => void,
): Promise<TestContext> => {
  const alepha = Alepha.create({
    env: {
      LOG_LEVEL: "error",
      SERVER_PORT: 0,
      DATABASE_URL: ":memory:",
    },
  });

  // Substitutions go in before any module registers the real service — the
  // container refuses a swap once something has been resolved.
  configure?.(alepha);

  alepha.with(AlephaOrm);
  alepha.with(AlephaServer);
  alepha.with(AlephaSecurity);
  alepha.with(AlephaEmail);
  alepha.with(AlephaApiUsers);
  alepha.with(AlephaFake);
  alepha.with(LoreApi);

  const probe = alepha.inject(Probe);
  await alepha.start();

  return {
    alepha,
    adminUserController: alepha.inject(AdminUserController),
    projectController: alepha.inject(ProjectController),
    appController: alepha.inject(AppController),
    sigilController: alepha.inject(SigilController),
    tokens: alepha.inject(SigilTokenService),
    probe,
    fakeProvider: alepha.inject(FakeProvider),
  };
};

const createTestUser = async (
  ctx: TestContext,
): Promise<{ id: string; roles: string[] }> => {
  const fakeUser = ctx.fakeProvider.generate(userDataSchema);
  const response = await ctx.adminUserController.createUser.fetch(
    { body: { ...fakeUser, roles: ["user"] } },
    { user: adminUser },
  );
  return { id: response.data.id, roles: response.data.roles };
};

/**
 * Project titles derive a globally unique URL slug, so two projects cannot
 * share one — several tests here create a second project to prove isolation.
 * A counter rather than a timestamp keeps the titles deterministic.
 */
let projectSeq = 0;

const createProject = async (
  ctx: TestContext,
  user: { id: string; roles: string[] },
): Promise<number> => {
  projectSeq += 1;
  const created = await ctx.projectController.createProject.fetch(
    {
      body: {
        title: `Sigil Test ${projectSeq}`,
        capabilities: [{ key: "apps" as const, options: { track: true } }],
      },
    },
    { user },
  );
  return created.data.id;
};

/**
 * The instance a sigil hangs off. Since Apps v3 a credential cannot be minted
 * without one, so every case here creates the deployed copy first and then
 * turns telemetry on for it.
 */
const createInstance = async (
  ctx: TestContext,
  projectId: number,
  user: { id: string; roles: string[] },
  app: string,
  env = "production",
): Promise<{ app: string; env: string }> => {
  const created = await ctx.appController.createApp.fetch(
    { params: { projectId }, body: { app, env } },
    { user },
  );
  return { app: created.data.app, env: created.data.env };
};

const expectStatus = async (promise: Promise<unknown>, status: number) => {
  const error = await promise.catch((e) => e);
  if (!(error instanceof HttpError)) {
    throw new Error(`Expected an HttpError ${status}, got ${String(error)}`);
  }
  if (error.status !== status) {
    throw new Error(`Expected ${status}, got ${error.status}`);
  }
};

describe("SigilController", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setup();
  });

  afterEach(async () => {
    await ctx.alepha.stop();
  });

  it("mints a token once, and never returns the hash", async ({ expect }) => {
    const owner = await createTestUser(ctx);
    const projectId = await createProject(ctx, owner);

    const instance = await createInstance(ctx, projectId, owner, "lore");
    const created = await ctx.sigilController.createSigil.fetch(
      { params: { projectId }, body: instance },
      { user: owner },
    );

    // The token names the project it was minted for, so the app it is pasted
    // into needs no second variable to say which project it reports to.
    const project = await ctx.probe.projects.findOne({
      where: { id: { eq: projectId } },
    });
    const slug = sigilKeyProject(created.data.token);
    expect(slug).toBe(project?.slug);

    // The stored prefix shows the whole namespace and barely any secret. A
    // fixed `slice(0, 11)` used to do this, and filed five characters of the
    // secret in a readable column for any project whose slug was short.
    const prefix = created.data.tokenPrefix;
    const secret = created.data.token.slice(`sg_${slug}_`.length);
    expect(created.data.token.startsWith(prefix)).toBe(true);
    expect(prefix).toBe(`sg_${slug}_${secret.slice(0, 4)}`);
    expect(secret.length).toBeGreaterThan(secret.slice(0, 4).length);

    expect("tokenHash" in created.data).toBe(false);
    // The token resolves to the sigil it was minted for, and to nothing else.
    const resolved = await ctx.tokens.verify(created.data.token);
    expect(resolved?.id).toBe(created.data.id);

    // And it is gone from every later read — the list carries the prefix only.
    const list = await ctx.sigilController.listSigils.fetch(
      { params: { projectId } },
      { user: owner },
    );
    expect("token" in list.data.items[0]).toBe(false);
  });

  it("names the sigil after the instance, and links the two", async ({
    expect,
  }) => {
    // `sigils.name` is a mirror written by `AppService` and by nobody else, so
    // the credential a caller gets back already says which deployed copy it
    // belongs to - which is what the blights filter and the insights dimension
    // render.
    const owner = await createTestUser(ctx);
    const projectId = await createProject(ctx, owner);
    const instance = await createInstance(ctx, projectId, owner, "club", "b14");

    const created = await ctx.sigilController.createSigil.fetch(
      { params: { projectId }, body: instance },
      { user: owner },
    );

    expect(created.data.name).toBe("club/b14");

    const app = await ctx.appController.getApp.fetch(
      { params: { projectId, ...instance } },
      { user: owner },
    );
    expect(app.data.sigilId).toBe(created.data.id);
    expect(app.data.sigil?.tokenPrefix).toBe(created.data.tokenPrefix);
  });

  it("404s when the instance does not exist", async () => {
    // The controller composes nothing: the two places a one-step flow is wanted
    // call `createApp` and then this, where the composition is visible.
    const owner = await createTestUser(ctx);
    const projectId = await createProject(ctx, owner);

    await expectStatus(
      ctx.sigilController.createSigil.fetch(
        { params: { projectId }, body: { app: "club", env: "production" } },
        { user: owner },
      ),
      404,
    );
  });

  it("409s when the instance already has a sigil", async ({ expect }) => {
    // A second credential for one deployed copy splits its history in two and
    // makes every aggregate wrong. Replacing one is `rotateSigil`.
    const owner = await createTestUser(ctx);
    const projectId = await createProject(ctx, owner);
    const instance = await createInstance(ctx, projectId, owner, "club");

    await ctx.sigilController.createSigil.fetch(
      { params: { projectId }, body: instance },
      { user: owner },
    );

    await expectStatus(
      ctx.sigilController.createSigil.fetch(
        { params: { projectId }, body: instance },
        { user: owner },
      ),
      409,
    );

    const list = await ctx.sigilController.listSigils.fetch(
      { params: { projectId } },
      { user: owner },
    );
    expect(list.data.items).toHaveLength(1);
  });

  it("leaves the instance alive when its sigil is removed", async ({
    expect,
  }) => {
    // The foreign key is `set null`, so removing a credential clears the link
    // and keeps the deployed copy: the four unlocked tabs go, the app does not.
    const owner = await createTestUser(ctx);
    const projectId = await createProject(ctx, owner);
    const instance = await createInstance(ctx, projectId, owner, "club");
    const created = await ctx.sigilController.createSigil.fetch(
      { params: { projectId }, body: instance },
      { user: owner },
    );

    await ctx.sigilController.deleteSigil.fetch(
      { params: { projectId, sigilId: created.data.id } },
      { user: owner },
    );

    const app = await ctx.appController.getApp.fetch(
      { params: { projectId, ...instance } },
      { user: owner },
    );
    expect(app.data.sigilId ?? null).toBeNull();
    expect(app.data.sigil).toBeUndefined();
  });

  it("lists a project's sigils, newest first", async ({ expect }) => {
    const owner = await createTestUser(ctx);
    const projectId = await createProject(ctx, owner);

    await ctx.sigilController.createSigil.fetch(
      {
        params: { projectId },
        body: await createInstance(ctx, projectId, owner, "lore", "staging"),
      },
      { user: owner },
    );
    await ctx.sigilController.createSigil.fetch(
      {
        params: { projectId },
        body: await createInstance(ctx, projectId, owner, "lore"),
      },
      { user: owner },
    );

    const list = await ctx.sigilController.listSigils.fetch(
      { params: { projectId } },
      { user: owner },
    );
    expect(list.data.items).toHaveLength(2);
    // The names are the mirror, written by `AppService` and by nothing else.
    expect(list.data.items.map((s) => s.name)).toContain("lore/production");
    expect(list.data.items.map((s) => s.name)).toContain("lore/staging");
  });

  it("rotates the token, keeping the app's history", async ({ expect }) => {
    const owner = await createTestUser(ctx);
    const projectId = await createProject(ctx, owner);

    const instance = await createInstance(ctx, projectId, owner, "lore");
    const created = await ctx.sigilController.createSigil.fetch(
      { params: { projectId }, body: instance },
      { user: owner },
    );
    await ctx.probe.views.create({
      sigilId: created.data.id,
      hour: "2026-08-01T10",
      path: "/",
      country: "FR",
      count: 7,
    });

    const rotated = await ctx.sigilController.rotateSigil.fetch(
      { params: { projectId, sigilId: created.data.id } },
      { user: owner },
    );

    // Same sigil, new credential.
    expect(rotated.data.id).toBe(created.data.id);
    expect(rotated.data.token).not.toBe(created.data.token);
    expect(await ctx.tokens.verify(created.data.token)).toBeUndefined();
    expect((await ctx.tokens.verify(rotated.data.token))?.id).toBe(
      created.data.id,
    );

    // …and the whole point: nothing it ever reported was lost.
    const views = await ctx.probe.views.findMany({
      where: { sigilId: { eq: created.data.id } },
    });
    expect(views).toHaveLength(1);
    expect(views[0].count).toBe(7);
  });

  it("replaces a sigil's kinds", async ({ expect }) => {
    const owner = await createTestUser(ctx);
    const projectId = await createProject(ctx, owner);

    const instance = await createInstance(ctx, projectId, owner, "lore");
    const created = await ctx.sigilController.createSigil.fetch(
      { params: { projectId }, body: instance },
      { user: owner },
    );
    expect(created.data.kinds).toEqual([
      "feedback",
      "blights",
      "beacon",
      "vitals",
    ]);

    const updated = await ctx.sigilController.updateSigil.fetch(
      {
        params: { projectId, sigilId: created.data.id },
        body: { kinds: ["beacon"] },
      },
      { user: owner },
    );

    expect(updated.data.kinds).toEqual(["beacon"]);
  });

  it("accepts an empty kinds list", async ({ expect }) => {
    const owner = await createTestUser(ctx);
    const projectId = await createProject(ctx, owner);

    const instance = await createInstance(ctx, projectId, owner, "lore");
    const created = await ctx.sigilController.createSigil.fetch(
      { params: { projectId }, body: instance },
      { user: owner },
    );

    const updated = await ctx.sigilController.updateSigil.fetch(
      {
        params: { projectId, sigilId: created.data.id },
        body: { kinds: [] },
      },
      { user: owner },
    );

    expect(updated.data.kinds).toEqual([]);
  });

  it("never returns the token hash", async ({ expect }) => {
    const owner = await createTestUser(ctx);
    const projectId = await createProject(ctx, owner);

    const instance = await createInstance(ctx, projectId, owner, "lore");
    const created = await ctx.sigilController.createSigil.fetch(
      { params: { projectId }, body: instance },
      { user: owner },
    );

    const updated = await ctx.sigilController.updateSigil.fetch(
      {
        params: { projectId, sigilId: created.data.id },
        body: { kinds: ["vitals"] },
      },
      { user: owner },
    );

    expect("tokenHash" in updated.data).toBe(false);
    expect("token" in updated.data).toBe(false);
  });

  it("deletes the sigil and everything it reported", async ({ expect }) => {
    const owner = await createTestUser(ctx);
    const projectId = await createProject(ctx, owner);

    const instance = await createInstance(ctx, projectId, owner, "lore");
    const created = await ctx.sigilController.createSigil.fetch(
      { params: { projectId }, body: instance },
      { user: owner },
    );
    await ctx.probe.views.create({
      sigilId: created.data.id,
      hour: "2026-08-01T10",
      path: "/",
      country: "FR",
      count: 7,
    });

    await ctx.sigilController.deleteSigil.fetch(
      { params: { projectId, sigilId: created.data.id } },
      { user: owner },
    );

    const list = await ctx.sigilController.listSigils.fetch(
      { params: { projectId } },
      { user: owner },
    );
    expect(list.data.items).toHaveLength(0);

    // The aggregates cascade — which is exactly why `rotateSigil` exists.
    const views = await ctx.probe.views.findMany({
      where: { sigilId: { eq: created.data.id } },
    });
    expect(views).toHaveLength(0);

    // Genuinely gone: a second delete is a clean 404, not a no-op.
    await expectStatus(
      ctx.sigilController.deleteSigil.fetch(
        { params: { projectId, sigilId: created.data.id } },
        { user: owner },
      ),
      404,
    );
  });

  it("lets a member read the inventory but not change it", async ({
    expect,
  }) => {
    const owner = await createTestUser(ctx);
    const member = await createTestUser(ctx);
    const projectId = await createProject(ctx, owner);
    await ctx.probe.members.create({ userId: member.id, projectId });

    const instance = await createInstance(ctx, projectId, owner, "lore");
    const created = await ctx.sigilController.createSigil.fetch(
      { params: { projectId }, body: instance },
      { user: owner },
    );

    // Reads are member-gated: the inventory drives the blights filter and the
    // insights page, neither of which is owner-only.
    const list = await ctx.sigilController.listSigils.fetch(
      { params: { projectId } },
      { user: member },
    );
    expect(list.data.items).toHaveLength(1);

    await expectStatus(
      ctx.sigilController.createSigil.fetch(
        { params: { projectId }, body: { app: "shop", env: "production" } },
        { user: member },
      ),
      403,
    );
    await expectStatus(
      ctx.sigilController.rotateSigil.fetch(
        { params: { projectId, sigilId: created.data.id } },
        { user: member },
      ),
      403,
    );
    await expectStatus(
      ctx.sigilController.updateSigil.fetch(
        {
          params: { projectId, sigilId: created.data.id },
          body: { kinds: ["beacon"] },
        },
        { user: member },
      ),
      403,
    );
    await expectStatus(
      ctx.sigilController.deleteSigil.fetch(
        { params: { projectId, sigilId: created.data.id } },
        { user: member },
      ),
      403,
    );
  });

  it("refuses a stranger everything, reads included", async () => {
    const owner = await createTestUser(ctx);
    const stranger = await createTestUser(ctx);
    const projectId = await createProject(ctx, owner);

    const instance = await createInstance(ctx, projectId, owner, "lore");
    const created = await ctx.sigilController.createSigil.fetch(
      { params: { projectId }, body: instance },
      { user: owner },
    );

    await expectStatus(
      ctx.sigilController.listSigils.fetch(
        { params: { projectId } },
        { user: stranger },
      ),
      403,
    );
    await expectStatus(
      ctx.sigilController.rotateSigil.fetch(
        { params: { projectId, sigilId: created.data.id } },
        { user: stranger },
      ),
      403,
    );
    await expectStatus(
      ctx.sigilController.updateSigil.fetch(
        {
          params: { projectId, sigilId: created.data.id },
          body: { kinds: ["beacon"] },
        },
        { user: stranger },
      ),
      403,
    );
    await expectStatus(
      ctx.sigilController.deleteSigil.fetch(
        { params: { projectId, sigilId: created.data.id } },
        { user: stranger },
      ),
      403,
    );
  });

  it("404s on a sigil that belongs to another project", async () => {
    const owner = await createTestUser(ctx);
    const projectA = await createProject(ctx, owner);
    const projectB = await createProject(ctx, owner);

    const created = await ctx.sigilController.createSigil.fetch(
      {
        params: { projectId: projectA },
        body: await createInstance(ctx, projectA, owner, "lore"),
      },
      { user: owner },
    );

    // The owner check would pass on project B; the project filter in
    // `loadSigil` is what stops the row being reachable from there.
    await expectStatus(
      ctx.sigilController.rotateSigil.fetch(
        { params: { projectId: projectB, sigilId: created.data.id } },
        { user: owner },
      ),
      404,
    );
    await expectStatus(
      ctx.sigilController.updateSigil.fetch(
        {
          params: { projectId: projectB, sigilId: created.data.id },
          body: { kinds: ["beacon"] },
        },
        { user: owner },
      ),
      404,
    );
    await expectStatus(
      ctx.sigilController.deleteSigil.fetch(
        { params: { projectId: projectB, sigilId: created.data.id } },
        { user: owner },
      ),
      404,
    );
  });
});

describe("SigilController — unique-index violations", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setup((alepha) =>
      alepha.with({ provide: SigilTokenService, use: FixedTokenService }),
    );
  });

  afterEach(async () => {
    await ctx.alepha.stop();
  });

  it("turns a constraint violation into a 409, not a 500", async ({
    expect,
  }) => {
    const owner = await createTestUser(ctx);
    const projectId = await createProject(ctx, owner);

    await ctx.sigilController.createSigil.fetch(
      {
        params: { projectId },
        body: await createInstance(ctx, projectId, owner, "lore"),
      },
      { user: owner },
    );

    // A DIFFERENT instance, so the 409 for "this one already has a sigil" does
    // not fire — the insert reaches the `tokenHash` unique index and the driver
    // refuses it. Without the catch this is an unhandled DbConflictError and a
    // 500.
    const second = await createInstance(
      ctx,
      projectId,
      owner,
      "lore",
      "staging",
    );
    await expectStatus(
      ctx.sigilController.createSigil.fetch(
        { params: { projectId }, body: second },
        { user: owner },
      ),
      409,
    );

    // ⚠️ And the failed insert left nothing behind: the sigil row is deleted
    // before the error is rethrown, because a credential no `app_instances` row
    // points at is unreachable from every page and still accepts ingest.
    const error: unknown = await ctx.sigilController.createSigil
      .fetch({ params: { projectId }, body: second }, { user: owner })
      .catch((e) => e);
    expect(error).toBeInstanceOf(HttpError);
    expect((error as HttpError).message).toMatch(/unique token/i);

    const list = await ctx.sigilController.listSigils.fetch(
      { params: { projectId } },
      { user: owner },
    );
    expect(list.data.items).toHaveLength(1);
  });
});
