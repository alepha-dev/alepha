import { sigilKeyProject } from "@alepha/sigil";
import { Alepha, z } from "alepha";
import { AdminUserController, AlephaApiUsers } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { AlephaFake, FakeProvider } from "alepha/fake";
import { $repository, AlephaOrm } from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer, HttpError } from "alepha/server";
import { afterEach, beforeEach, describe, it } from "vitest";

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
  sigilController: SigilController;
  tokens: SigilTokenService;
  probe: Probe;
  fakeProvider: FakeProvider;
}

/**
 * A token service that mints one token, forever.
 *
 * Substituted in to force the *other* unique index on `sigils` — `tokenHash` —
 * to be the one that refuses an insert. It is the only unique index a test can
 * trip deterministically: the `(projectId, name)` one is guarded
 * by a `findOne` that a single-connection in-memory database never lets a
 * second caller slip past, which is exactly why the handler cannot rely on
 * that check alone in production.
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
    { body: { title: `Sigil Test ${projectSeq}` } },
    { user },
  );
  return created.data.id;
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

    const created = await ctx.sigilController.createSigil.fetch(
      { params: { projectId }, body: { name: "lore" } },
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

  it("lowercases and trims the name before storing it", async ({ expect }) => {
    const owner = await createTestUser(ctx);
    const projectId = await createProject(ctx, owner);

    const created = await ctx.sigilController.createSigil.fetch(
      { params: { projectId }, body: { name: "  Lore-Staging  " } },
      { user: owner },
    );

    expect(created.data.name).toBe("lore-staging");
  });

  it("refuses a name with a space", async ({ expect }) => {
    const owner = await createTestUser(ctx);
    const projectId = await createProject(ctx, owner);

    await expect(
      ctx.sigilController.createSigil.fetch(
        { params: { projectId }, body: { name: "lore staging" } },
        { user: owner },
      ),
    ).rejects.toThrow(/lowercase letters, digits and hyphens/i);
  });

  it("refuses a leading or trailing hyphen", async ({ expect }) => {
    const owner = await createTestUser(ctx);
    const projectId = await createProject(ctx, owner);

    for (const name of ["-lore", "lore-"]) {
      await expect(
        ctx.sigilController.createSigil.fetch(
          { params: { projectId }, body: { name } },
          { user: owner },
        ),
      ).rejects.toThrow(/lowercase letters, digits and hyphens/i);
    }
  });

  it("refuses a name longer than 64 characters", async ({ expect }) => {
    const owner = await createTestUser(ctx);
    const projectId = await createProject(ctx, owner);

    await expect(
      ctx.sigilController.createSigil.fetch(
        { params: { projectId }, body: { name: "a".repeat(65) } },
        { user: owner },
      ),
    ).rejects.toThrow();
  });

  it("refuses a name that is only whitespace", async () => {
    const owner = await createTestUser(ctx);
    const projectId = await createProject(ctx, owner);

    // `min(1)` accepts "   ", so without the handler's own guard this reaches
    // the insert as an empty name and fails entity validation as a 500.
    await expectStatus(
      ctx.sigilController.createSigil.fetch(
        { params: { projectId }, body: { name: "   " } },
        { user: owner },
      ),
      400,
    );
  });

  it("refuses a second sigil with the same name", async ({ expect }) => {
    const owner = await createTestUser(ctx);
    const projectId = await createProject(ctx, owner);

    await ctx.sigilController.createSigil.fetch(
      { params: { projectId }, body: { name: "lore" } },
      { user: owner },
    );

    // A duplicate would split that app's history across two rows and make every
    // aggregate wrong — 409, not a silent second sigil.
    const error: unknown = await ctx.sigilController.createSigil
      .fetch({ params: { projectId }, body: { name: "lore" } }, { user: owner })
      .catch((e) => e);
    expect(error).toBeInstanceOf(HttpError);
    expect((error as HttpError).status).toBe(409);
    // The message names the clash, so an operator knows which name to change.
    expect((error as HttpError).message).toMatch(/already exists named "lore"/);

    const list = await ctx.sigilController.listSigils.fetch(
      { params: { projectId } },
      { user: owner },
    );
    expect(list.data.items).toHaveLength(1);
  });

  it("lets two projects each have a sigil of the same name", async ({
    expect,
  }) => {
    const owner = await createTestUser(ctx);
    const projectA = await createProject(ctx, owner);
    const projectB = await createProject(ctx, owner);

    // Uniqueness is `(projectId, name)`, not `name` — two people tracking an
    // app called `lore` do not collide with each other.
    await ctx.sigilController.createSigil.fetch(
      { params: { projectId: projectA }, body: { name: "lore" } },
      { user: owner },
    );
    const second = await ctx.sigilController.createSigil.fetch(
      { params: { projectId: projectB }, body: { name: "lore" } },
      { user: owner },
    );

    expect(second.data.name).toBe("lore");
  });

  it("lists a project's sigils, newest first", async ({ expect }) => {
    const owner = await createTestUser(ctx);
    const projectId = await createProject(ctx, owner);

    await ctx.sigilController.createSigil.fetch(
      { params: { projectId }, body: { name: "lore-staging" } },
      { user: owner },
    );
    await ctx.sigilController.createSigil.fetch(
      { params: { projectId }, body: { name: "lore" } },
      { user: owner },
    );

    const list = await ctx.sigilController.listSigils.fetch(
      { params: { projectId } },
      { user: owner },
    );
    expect(list.data.items).toHaveLength(2);
    expect(list.data.items.map((s) => s.name)).toContain("lore");
    expect(list.data.items.map((s) => s.name)).toContain("lore-staging");
  });

  it("rotates the token, keeping the app's history", async ({ expect }) => {
    const owner = await createTestUser(ctx);
    const projectId = await createProject(ctx, owner);

    const created = await ctx.sigilController.createSigil.fetch(
      { params: { projectId }, body: { name: "lore" } },
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

    const created = await ctx.sigilController.createSigil.fetch(
      { params: { projectId }, body: { name: "lore" } },
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

  describe("rename", () => {
    it("renames an app, normalising the way enrolment does", async ({
      expect,
    }) => {
      const owner = await createTestUser(ctx);
      const projectId = await createProject(ctx, owner);

      const created = await ctx.sigilController.createSigil.fetch(
        { params: { projectId }, body: { name: "lore" } },
        { user: owner },
      );

      const updated = await ctx.sigilController.updateSigil.fetch(
        {
          params: { projectId, sigilId: created.data.id },
          // Enrolment accepts this and stores `lore-staging`; a rename that
          // refused it, or stored it differently, would make a name reachable
          // one way and not the other.
          body: { name: "  Lore-Staging  " },
        },
        { user: owner },
      );

      expect(updated.data.name).toBe("lore-staging");
    });

    it("leaves the name alone when the key is omitted", async ({ expect }) => {
      const owner = await createTestUser(ctx);
      const projectId = await createProject(ctx, owner);

      const created = await ctx.sigilController.createSigil.fetch(
        { params: { projectId }, body: { name: "lore" } },
        { user: owner },
      );

      const updated = await ctx.sigilController.updateSigil.fetch(
        {
          params: { projectId, sigilId: created.data.id },
          body: { kinds: ["beacon"] },
        },
        { user: owner },
      );

      expect(updated.data.name).toBe("lore");
    });

    /**
     * `url` treats `""` as "clear" because it is an override whose absence is
     * meaningful. A name has no such reading: an app without one has no URL
     * segment, so an empty name is a validation error and never a clear.
     */
    it("refuses an empty name rather than clearing it", async ({ expect }) => {
      const owner = await createTestUser(ctx);
      const projectId = await createProject(ctx, owner);

      const created = await ctx.sigilController.createSigil.fetch(
        { params: { projectId }, body: { name: "lore" } },
        { user: owner },
      );

      await expect(
        ctx.sigilController.updateSigil.fetch(
          {
            params: { projectId, sigilId: created.data.id },
            body: { name: "   " },
          },
          { user: owner },
        ),
      ).rejects.toThrowError();

      const after = await ctx.sigilController.listSigils.fetch(
        { params: { projectId } },
        { user: owner },
      );
      expect(after.data.items[0]?.name).toBe("lore");
    });

    /**
     * `(projectId, name)` is a unique index, so without a check first this
     * would surface as a driver constraint violation - a 500 for what is a
     * caller's mistake.
     */
    it("refuses a name another app in the project already has", async ({
      expect,
    }) => {
      const owner = await createTestUser(ctx);
      const projectId = await createProject(ctx, owner);

      await ctx.sigilController.createSigil.fetch(
        { params: { projectId }, body: { name: "lore" } },
        { user: owner },
      );
      const second = await ctx.sigilController.createSigil.fetch(
        { params: { projectId }, body: { name: "docs" } },
        { user: owner },
      );

      await expect(
        ctx.sigilController.updateSigil.fetch(
          {
            params: { projectId, sigilId: second.data.id },
            body: { name: "lore" },
          },
          { user: owner },
        ),
      ).rejects.toThrowError(/already exists named/);
    });

    it("lets an app be renamed to the name it already has", async ({
      expect,
    }) => {
      const owner = await createTestUser(ctx);
      const projectId = await createProject(ctx, owner);

      const created = await ctx.sigilController.createSigil.fetch(
        { params: { projectId }, body: { name: "lore" } },
        { user: owner },
      );

      // A no-op, not a collision with itself. Reachable from the UI whenever
      // the case or the whitespace differs from what is stored.
      const updated = await ctx.sigilController.updateSigil.fetch(
        {
          params: { projectId, sigilId: created.data.id },
          body: { name: "LORE" },
        },
        { user: owner },
      );

      expect(updated.data.name).toBe("lore");
    });

    it("refuses a name that is not a legal URL segment", async ({ expect }) => {
      const owner = await createTestUser(ctx);
      const projectId = await createProject(ctx, owner);

      const created = await ctx.sigilController.createSigil.fetch(
        { params: { projectId }, body: { name: "lore" } },
        { user: owner },
      );

      for (const name of ["lore staging", "-lore", "lore-", "lore/prod"]) {
        await expect(
          ctx.sigilController.updateSigil.fetch(
            {
              params: { projectId, sigilId: created.data.id },
              body: { name },
            },
            { user: owner },
          ),
        ).rejects.toThrowError();
      }
    });
  });

  it("accepts an empty kinds list", async ({ expect }) => {
    const owner = await createTestUser(ctx);
    const projectId = await createProject(ctx, owner);

    const created = await ctx.sigilController.createSigil.fetch(
      { params: { projectId }, body: { name: "lore" } },
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

    const created = await ctx.sigilController.createSigil.fetch(
      { params: { projectId }, body: { name: "lore" } },
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

    const created = await ctx.sigilController.createSigil.fetch(
      { params: { projectId }, body: { name: "lore" } },
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

    const created = await ctx.sigilController.createSigil.fetch(
      { params: { projectId }, body: { name: "lore" } },
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
        { params: { projectId }, body: { name: "shop" } },
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

    const created = await ctx.sigilController.createSigil.fetch(
      { params: { projectId }, body: { name: "lore" } },
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
        body: { name: "lore" },
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
      { params: { projectId }, body: { name: "lore" } },
      { user: owner },
    );

    // Different name, so the handler's own duplicate check passes — the insert
    // reaches the `tokenHash` unique index and the driver refuses it. Without
    // the catch this is an unhandled DbConflictError and a 500.
    await expectStatus(
      ctx.sigilController.createSigil.fetch(
        {
          params: { projectId },
          body: { name: "lore-staging" },
        },
        { user: owner },
      ),
      409,
    );

    // And the message points at the token, not at a sigil that does not exist:
    // the same status has to mean two different things to the caller.
    const error: unknown = await ctx.sigilController.createSigil
      .fetch(
        {
          params: { projectId },
          body: { name: "lore-staging" },
        },
        { user: owner },
      )
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
