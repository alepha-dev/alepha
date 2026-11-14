import { Alepha } from "alepha";
import { AlephaApiUsers } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { $repository, AlephaOrm } from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import {
  AlephaServer,
  BadRequestError,
  ConflictError,
  NotFoundError,
} from "alepha/server";
import { afterEach, beforeEach, describe, it } from "vitest";

import { LoreShipApi } from "../src/api/index.ts";
import { AppService, HostService } from "../src/api/index.ts";
import {
  appInstances,
  hostProjects,
  hosts,
  type Sigil,
  sigils,
} from "../src/schemas/index.ts";
import { createTestProject, DeployTestEntities } from "../src/testing/index.ts";

/**
 * The tables this spec writes to directly, registered pre-`start()` like every
 * other lore spec: a `$repository` registers its table with the provider from
 * its constructor, and the schema sync resolves foreign keys only against
 * tables it has already seen.
 */
class AppRepositories {
  instances = $repository(appInstances);
  sigils = $repository(sigils);
  hosts = $repository(hosts);
  grants = $repository(hostProjects);
}

interface TestContext {
  alepha: Alepha;
  service: AppService;
  hostService: HostService;
  repos: AppRepositories;
}

/**
 * Pinned to `:memory:`, like every other lore spec: the ROOT vitest config —
 * the one CI runs — sets `DATABASE_URL` to a Postgres URL, which this app's
 * SQLite provider rejects outright.
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
  alepha.with(LoreShipApi);

  alepha.inject(DeployTestEntities);
  const repos = alepha.inject(AppRepositories);

  await alepha.start();

  return {
    alepha,
    service: alepha.inject(AppService),
    hostService: alepha.inject(HostService),
    repos,
  };
};

/**
 * A sigil row straight through the repository. Nothing here reads the
 * credential — these tests are about the instance that holds it.
 */
let sigilSeq = 0;
let hostSeq = 0;
const createTestSigil = async (
  ctx: TestContext,
  projectId: number,
  name: string,
): Promise<Sigil> => {
  sigilSeq += 1;
  return ctx.repos.sigils.create({
    projectId,
    name,
    tokenHash: `hash-${sigilSeq}`,
    tokenPrefix: "sg_test_",
    kinds: ["beacon"],
  });
};

describe("AppService — the two names that are the row", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setup();
  });

  afterEach(async () => {
    await ctx.alepha.stop();
  });

  it("normalises both halves the way enrolment always has", async ({
    expect,
  }) => {
    // Trimmed and lowercased rather than refused: the case is not a
    // distinction anyone means in a URL segment.
    const project = await createTestProject(ctx.alepha);

    const instance = await ctx.service.create({
      projectId: project.id,
      app: "  Acme  ",
      env: "  East-Production ",
    });

    expect(instance.app).toBe("acme");
    expect(instance.env).toBe("east-production");
  });

  it("refuses either half outside the URL charset", async ({ expect }) => {
    const project = await createTestProject(ctx.alepha);

    for (const pair of [
      { app: "acme prod", env: "production" },
      { app: "-acme", env: "production" },
      { app: "acme-", env: "production" },
      // `/` is the segment separator AND the mirror's separator, so it is the
      // one character that must never reach either column.
      { app: "acme/prod", env: "production" },
      { app: "acme", env: "prod uction" },
      { app: "acme", env: "   " },
    ]) {
      await expect(
        ctx.service.create({ projectId: project.id, ...pair }),
      ).rejects.toThrow(BadRequestError);
    }
  });

  it("says which half it is refusing", async ({ expect }) => {
    // Two fields on one dialog. A message naming neither leaves an operator
    // guessing which one to fix.
    const project = await createTestProject(ctx.alepha);

    await expect(
      ctx.service.create({
        projectId: project.id,
        app: "acme",
        env: "bad env",
      }),
    ).rejects.toThrow(/environment name/);
  });

  it("refuses a pair too long to mirror onto `sigils.name`", async ({
    expect,
  }) => {
    // 99 is the bound, and the failure it prevents is not a bad request: a
    // 129-character mirror fails the column's read validation and throws every
    // query that touches `sigils`.
    const project = await createTestProject(ctx.alepha);

    await expect(
      ctx.service.create({
        projectId: project.id,
        app: "a".repeat(60),
        env: "b".repeat(40),
      }),
    ).rejects.toThrow(BadRequestError);

    // One under the bound still passes, so the check is the bound and not an
    // off-by-one below it.
    const instance = await ctx.service.create({
      projectId: project.id,
      app: "a".repeat(60),
      env: "b".repeat(39),
    });
    expect(instance.app.length + instance.env.length).toBe(99);
  });

  it("refuses a second instance with the same pair", async ({ expect }) => {
    const project = await createTestProject(ctx.alepha);
    await ctx.service.create({
      projectId: project.id,
      app: "acme",
      env: "production",
    });

    await expect(
      ctx.service.create({
        projectId: project.id,
        app: "acme",
        env: "production",
      }),
    ).rejects.toThrow(ConflictError);
  });

  it("lets one app hold several environments", async ({ expect }) => {
    // The whole reason the level exists: `acme` in production and `acme` in
    // `east-production` are two deployed copies, not a duplicate.
    const project = await createTestProject(ctx.alepha);

    await ctx.service.create({
      projectId: project.id,
      app: "acme",
      env: "production",
    });
    const second = await ctx.service.create({
      projectId: project.id,
      app: "acme",
      env: "east-production",
    });

    expect(second.app).toBe("acme");
  });

  it("lets two projects each hold the same pair", async ({ expect }) => {
    // Uniqueness is `(projectId, app, env)`, never `(app, env)`.
    const projectA = await createTestProject(ctx.alepha);
    const projectB = await createTestProject(ctx.alepha);

    await ctx.service.create({
      projectId: projectA.id,
      app: "acme",
      env: "production",
    });
    const second = await ctx.service.create({
      projectId: projectB.id,
      app: "acme",
      env: "production",
    });

    expect(second.projectId).toBe(projectB.id);
  });

  it("mints nothing", async ({ expect }) => {
    // The point of the epic. A sigil is an unlock added afterwards, never a
    // side effect of naming an app.
    const project = await createTestProject(ctx.alepha);

    const instance = await ctx.service.create({
      projectId: project.id,
      app: "acme",
      env: "production",
    });

    expect(instance.sigilId ?? null).toBeNull();
    const minted = await ctx.repos.sigils.findMany({
      where: { projectId: { eq: project.id } },
    });
    expect(minted).toHaveLength(0);
  });
});

describe("AppService — renaming either half, and the `sigils.name` mirror", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setup();
  });

  afterEach(async () => {
    await ctx.alepha.stop();
  });

  it("renames the app half, normalising the way create does", async ({
    expect,
  }) => {
    const project = await createTestProject(ctx.alepha);
    const instance = await ctx.service.create({
      projectId: project.id,
      app: "acme",
      env: "production",
    });

    const renamed = await ctx.service.rename(instance, { app: "  Lore-App " });

    expect(renamed.app).toBe("lore-app");
    expect(renamed.env).toBe("production");
  });

  it("leaves the half the caller did not mention", async ({ expect }) => {
    const project = await createTestProject(ctx.alepha);
    const instance = await ctx.service.create({
      projectId: project.id,
      app: "acme",
      env: "staging",
    });

    const renamed = await ctx.service.rename(instance, { env: "production" });

    expect(renamed.app).toBe("acme");
    expect(renamed.env).toBe("production");
  });

  it("carries the mirror onto the sigil, in the same call", async ({
    expect,
  }) => {
    // Two calls would leave a window where the pair is one thing here and
    // another on `sigils`, and nothing would ever repair it.
    const project = await createTestProject(ctx.alepha);
    const sigil = await createTestSigil(ctx, project.id, "acme/production");
    const instance = await ctx.service.create({
      projectId: project.id,
      app: "acme",
      env: "production",
    });
    await ctx.repos.instances.updateById(instance.id, { sigilId: sigil.id });

    await ctx.service.rename(
      { ...instance, sigilId: sigil.id },
      { env: "east-production" },
    );

    const stored = await ctx.repos.sigils.getById(sigil.id);
    expect(stored.name).toBe("acme/east-production");
  });

  it("refuses a pair another instance already holds", async ({ expect }) => {
    const project = await createTestProject(ctx.alepha);
    await ctx.service.create({
      projectId: project.id,
      app: "acme",
      env: "production",
    });
    const second = await ctx.service.create({
      projectId: project.id,
      app: "acme",
      env: "staging",
    });

    await expect(
      ctx.service.rename(second, { env: "production" }),
    ).rejects.toThrow(ConflictError);
  });

  it("treats renaming to the pair it already holds as a no-op", async ({
    expect,
  }) => {
    // Reachable from the UI whenever the case or the whitespace differs from
    // what is stored. A collision with itself would be nonsense.
    const project = await createTestProject(ctx.alepha);
    const instance = await ctx.service.create({
      projectId: project.id,
      app: "acme",
      env: "production",
    });

    const renamed = await ctx.service.rename(instance, {
      app: "ACME",
      env: "PRODUCTION",
    });

    expect(renamed.app).toBe("acme");
    expect(renamed.env).toBe("production");
  });

  it("refuses a rename that would make the mirror too long", async ({
    expect,
  }) => {
    const project = await createTestProject(ctx.alepha);
    const instance = await ctx.service.create({
      projectId: project.id,
      app: "acme",
      env: "production",
    });

    await expect(
      ctx.service.rename(instance, { env: "e".repeat(96) }),
    ).rejects.toThrow(BadRequestError);
  });
});

describe("AppService — the address an operator pins", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setup();
  });

  afterEach(async () => {
    await ctx.alepha.stop();
  });

  const instanceOf = async (ctx: TestContext) => {
    const project = await createTestProject(ctx.alepha);
    return ctx.service.create({
      projectId: project.id,
      app: "acme",
      env: "production",
    });
  };

  it("stores a URL, without its redundant trailing slash", async ({
    expect,
  }) => {
    const instance = await instanceOf(ctx);

    const updated = await ctx.service.setUrl(
      instance,
      "  https://alepha.dev/ ",
    );

    expect(updated.url).toBe("https://alepha.dev");
  });

  it("keeps a path, which is the only reason to type one by hand", async ({
    expect,
  }) => {
    const instance = await instanceOf(ctx);

    const updated = await ctx.service.setUrl(
      instance,
      "https://alepha.dev/docs",
    );

    expect(updated.url).toBe("https://alepha.dev/docs");
  });

  it("clears the override when the field is emptied", async ({ expect }) => {
    // The way back to the detected host. Without it, a wrong address pinned
    // once could never be taken off.
    const instance = await instanceOf(ctx);
    await ctx.service.setUrl(instance, "https://wrong.example.com");

    const updated = await ctx.service.setUrl(instance, "   ");

    expect(updated.url ?? null).toBeNull();
    const stored = await ctx.repos.instances.getById(instance.id);
    expect(stored.url ?? null).toBeNull();
  });

  it("refuses a javascript: URL, which would become an href", async ({
    expect,
  }) => {
    // `new URL()` parses this perfectly happily, which is exactly why the
    // protocol is checked rather than assumed.
    const instance = await instanceOf(ctx);

    await expect(
      ctx.service.setUrl(instance, "javascript:alert(1)"),
    ).rejects.toThrow(BadRequestError);
  });

  it("refuses a relative URL, which would point back at Lore", async ({
    expect,
  }) => {
    const instance = await instanceOf(ctx);

    await expect(ctx.service.setUrl(instance, "alepha.dev")).rejects.toThrow(
      BadRequestError,
    );
  });
});

describe("AppService — the host an instance deploys to", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setup();
  });

  afterEach(async () => {
    await ctx.alepha.stop();
  });

  /**
   * A host its owner has NOT lent to the project, plus the grant on
   * request. Two arrangements, because the whole rule is the difference
   * between them.
   */
  const anHost = async (
    ctx: TestContext,
    projectId: number,
    { lend }: { lend: boolean },
  ) => {
    // A real `users` row, not a bare uuid: `hosts.ownerUserId` cascades on
    // that foreign key, so an unbacked id fails at the insert for a reason
    // that has nothing to do with the host.
    const users = ctx.alepha.inject(DeployTestEntities).users;
    const owner = await users.create({});
    hostSeq += 1;
    const host = await ctx.repos.hosts.create({
      ownerUserId: owner.id,
      type: "bay",
      slug: `ovh-${hostSeq}`,
    });
    if (lend) {
      await ctx.repos.grants.create({ hostId: host.id, projectId });
    }
    return host;
  };

  it("accepts a host the project has been lent", async ({ expect }) => {
    const project = await createTestProject(ctx.alepha);
    const instance = await ctx.service.create({
      projectId: project.id,
      app: "acme",
      env: "production",
    });
    const host = await anHost(ctx, project.id, { lend: true });

    const updated = await ctx.service.setHost(instance, host.id);

    expect(updated.hostId).toBe(host.id);
  });

  it("refuses one the project was never lent, as a 404", async ({ expect }) => {
    // Validated against `host_projects` and never against `hosts`:
    // resolving the id straight would let a project point at somebody else's
    // cloud account, which is folio #96's `targetId` hole wearing a foreign
    // key. The 404 is deliberate too — a project that was never lent a host
    // should not learn that it exists.
    const project = await createTestProject(ctx.alepha);
    const instance = await ctx.service.create({
      projectId: project.id,
      app: "acme",
      env: "production",
    });
    const host = await anHost(ctx, project.id, { lend: false });

    await expect(ctx.service.setHost(instance, host.id)).rejects.toThrow(
      NotFoundError,
    );

    const stored = await ctx.repos.instances.getById(instance.id);
    expect(stored.hostId ?? null).toBeNull();
  });

  it("clears the host on null", async ({ expect }) => {
    const project = await createTestProject(ctx.alepha);
    const instance = await ctx.service.create({
      projectId: project.id,
      app: "acme",
      env: "production",
    });
    const host = await anHost(ctx, project.id, { lend: true });
    await ctx.service.setHost(instance, host.id);

    const cleared = await ctx.service.setHost(instance, null);

    expect(cleared.hostId ?? null).toBeNull();
    // ⚠️ Read back from the DATABASE, not from the returned object. The method
    // builds its answer in memory, so asserting on that proves the method
    // returns what it says and nothing about what it wrote - which is exactly
    // how a clear that never reached the column would pass.
    const stored = await ctx.repos.instances.getById(instance.id);
    expect(stored.hostId ?? null).toBeNull();
  });

  it("refuses to detach a host an instance still points at", async ({
    expect,
  }) => {
    // Never cascade: cascading silently breaks other people's projects, while
    // refusing forces a visible repoint. The message names the instance,
    // because the operator's next action is to open it.
    const project = await createTestProject(ctx.alepha);
    const instance = await ctx.service.create({
      projectId: project.id,
      app: "acme",
      env: "production",
    });
    const host = await anHost(ctx, project.id, { lend: true });
    await ctx.service.setHost(instance, host.id);

    await expect(
      ctx.hostService.assertUnreferenced(host.id, project.id),
    ).rejects.toThrow(/acme\/production/);
  });

  it("lets another project's detach through", async ({ expect }) => {
    // With a `projectId` the question is narrower: only that project's
    // instances block a detach.
    const project = await createTestProject(ctx.alepha);
    const other = await createTestProject(ctx.alepha);
    const instance = await ctx.service.create({
      projectId: project.id,
      app: "acme",
      env: "production",
    });
    const host = await anHost(ctx, project.id, { lend: true });
    await ctx.service.setHost(instance, host.id);

    await expect(
      ctx.hostService.assertUnreferenced(host.id, other.id),
    ).resolves.toBeUndefined();

    // Without one, any instance anywhere blocks the delete.
    await expect(ctx.hostService.assertUnreferenced(host.id)).rejects.toThrow();
  });

  it("stops blocking once the instance is repointed at nothing", async ({
    expect,
  }) => {
    // ⚠️ The path the e2e drives: point, refuse, clear, detach. Asserted here
    // too because the refusal and the clear are two different queries over the
    // same column, and a `where` that silently stopped filtering would leave
    // the refusal permanent.
    const project = await createTestProject(ctx.alepha);
    const instance = await ctx.service.create({
      projectId: project.id,
      app: "acme",
      env: "production",
    });
    const host = await anHost(ctx, project.id, { lend: true });
    await ctx.service.setHost(instance, host.id);
    await expect(
      ctx.hostService.assertUnreferenced(host.id, project.id),
    ).rejects.toThrow();

    await ctx.service.setHost(instance, null);

    await expect(
      ctx.hostService.assertUnreferenced(host.id, project.id),
    ).resolves.toBeUndefined();
  });

  it("lets an unreferenced host through", async ({ expect }) => {
    const project = await createTestProject(ctx.alepha);
    const host = await anHost(ctx, project.id, { lend: true });

    await expect(
      ctx.hostService.assertUnreferenced(host.id),
    ).resolves.toBeUndefined();
  });
});

describe("AppService — the default instance, and deletion", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setup();
  });

  afterEach(async () => {
    await ctx.alepha.stop();
  });

  it("prefers `production` whatever it sorts next to", async ({ expect }) => {
    // The rule the `/apps/:app` redirect and the `sigil_create` shim share, so
    // they cannot disagree. `a-staging` sorts first by name and must still
    // lose to production.
    const project = await createTestProject(ctx.alepha);
    await ctx.service.create({
      projectId: project.id,
      app: "acme",
      env: "a-staging",
    });
    await ctx.service.create({
      projectId: project.id,
      app: "acme",
      env: "production",
    });

    const chosen = await ctx.service.defaultInstance(project.id, "acme");

    expect(chosen?.env).toBe("production");
  });

  it("falls back to the first env by name", async ({ expect }) => {
    const project = await createTestProject(ctx.alepha);
    await ctx.service.create({
      projectId: project.id,
      app: "acme",
      env: "staging",
    });
    await ctx.service.create({
      projectId: project.id,
      app: "acme",
      env: "east-production",
    });

    const chosen = await ctx.service.defaultInstance(project.id, "acme");

    expect(chosen?.env).toBe("east-production");
  });

  it("answers undefined for an app with no instance", async ({ expect }) => {
    const project = await createTestProject(ctx.alepha);

    expect(
      await ctx.service.defaultInstance(project.id, "nothing"),
    ).toBeUndefined();
  });

  it("takes the sigil with the instance", async ({ expect }) => {
    // Enforced in the service the way `ArtifactService` enforces `fileId`: the
    // foreign key is `set null` in the other direction, so this cascade cannot
    // be expressed as a constraint.
    const project = await createTestProject(ctx.alepha);
    const sigil = await createTestSigil(ctx, project.id, "acme/production");
    const instance = await ctx.service.create({
      projectId: project.id,
      app: "acme",
      env: "production",
    });
    await ctx.repos.instances.updateById(instance.id, { sigilId: sigil.id });

    await ctx.service.delete({ ...instance, sigilId: sigil.id });

    expect(
      await ctx.repos.instances.findOne({ where: { id: { eq: instance.id } } }),
    ).toBeUndefined();
    expect(
      await ctx.repos.sigils.findOne({ where: { id: { eq: sigil.id } } }),
    ).toBeUndefined();
  });

  it("leaves a sigil-less instance's deletion alone", async ({ expect }) => {
    const project = await createTestProject(ctx.alepha);
    const instance = await ctx.service.create({
      projectId: project.id,
      app: "acme",
      env: "production",
    });

    await ctx.service.delete(instance);

    expect(
      await ctx.repos.instances.findOne({ where: { id: { eq: instance.id } } }),
    ).toBeUndefined();
  });
});
