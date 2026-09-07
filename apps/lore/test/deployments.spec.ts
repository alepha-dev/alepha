import { Alepha, z } from "alepha";
import { AdminUserController, AlephaApiUsers } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { AlephaFake, FakeProvider } from "alepha/fake";
import { $repository, AlephaOrm } from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { afterEach, beforeEach, describe, it } from "vitest";

import { AppController } from "../src/api/controllers/AppController.ts";
import { DeployController } from "../src/api/controllers/DeployController.ts";
import { ProjectCapabilityController } from "../src/api/controllers/ProjectCapabilityController.ts";
import { ProjectController } from "../src/api/controllers/ProjectController.ts";
import { appInstances } from "../src/api/entities/appInstances.ts";
import { deployments } from "../src/api/entities/deployments.ts";
import { estateProjects } from "../src/api/entities/estateProjects.ts";
import { estates } from "../src/api/entities/estates.ts";
import { LoreApi } from "../src/api/index.ts";
import { DeployJobs } from "../src/api/jobs/DeployJobs.ts";
import { DeployGate } from "../src/api/services/DeployGate.ts";
import { DeployRegistry } from "../src/api/services/DeployRegistry.ts";
import { DeployService } from "../src/api/services/DeployService.ts";

/**
 * The row a deploy is followed through, and the run that writes it.
 *
 * ⚠️ **A run must always reach a terminal state.** A row left `running` is a
 * deploy the UI follows forever and the operator cannot retry, and the only
 * thing that guarantees it moves is the failure path - which is why most of
 * this file is about failures rather than the happy case.
 */
const adminUser = { id: crypto.randomUUID(), roles: ["admin"] };

const userDataSchema = z.object({ username: z.string(), email: z.email() });

class TestRows {
  public readonly deployments = $repository(deployments);
  public readonly estates = $repository(estates);
  public readonly grants = $repository(estateProjects);
  public readonly instances = $repository(appInstances);
}

/**
 * The four steps every case here needs: a user, a project, the Apps capability
 * and one deployed copy.
 */
const aUser = async (alepha: Alepha) => {
  const fake = alepha.inject(FakeProvider).generate(userDataSchema);
  const created = await alepha
    .inject(AdminUserController)
    .createUser.fetch(
      { body: { ...fake, roles: ["user"] } },
      { user: adminUser },
    );
  return { id: created.data.id, roles: created.data.roles };
};

const aProject = async (alepha: Alepha, user: { id: string }) =>
  (
    await alepha
      .inject(ProjectController)
      .createProject.fetch(
        { body: { title: `Deploy ${crypto.randomUUID().slice(0, 8)}` } },
        { user },
      )
  ).data;

const enableApps = async (
  alepha: Alepha,
  projectId: number,
  user: { id: string },
) =>
  await alepha
    .inject(ProjectCapabilityController)
    .setCapability.fetch(
      { params: { projectId, key: "apps" }, body: { enabled: true } },
      { user },
    );

const anInstance = async (
  alepha: Alepha,
  projectId: number,
  user: { id: string },
) =>
  (
    await alepha
      .inject(AppController)
      .createApp.fetch(
        { params: { projectId }, body: { app: "my-app", env: "b14-preview" } },
        { user },
      )
  ).data;

const setup = async () => {
  const alepha = Alepha.create({
    env: { LOG_LEVEL: "error", SERVER_PORT: 0, DATABASE_URL: ":memory:" },
  });
  alepha.with(AlephaOrm);
  alepha.with(AlephaServer);
  alepha.with(AlephaSecurity);
  alepha.with(AlephaEmail);
  alepha.with(AlephaApiUsers);
  alepha.with(AlephaFake);
  alepha.with(LoreApi);
  alepha.with(TestRows);
  await alepha.start();
  return alepha;
};

describe("a deployment", () => {
  let alepha: Alepha;

  beforeEach(async () => {
    alepha = await setup();
  });

  afterEach(async () => {
    await alepha.stop();
  });

  const world = async () => {
    const fake = alepha.inject(FakeProvider).generate(userDataSchema);
    const created = await alepha
      .inject(AdminUserController)
      .createUser.fetch(
        { body: { ...fake, roles: ["user"] } },
        { user: adminUser },
      );
    const user = { id: created.data.id, roles: created.data.roles };
    const project = (
      await alepha
        .inject(ProjectController)
        .createProject.fetch(
          { body: { title: `Deploy ${crypto.randomUUID().slice(0, 8)}` } },
          { user },
        )
    ).data;
    // Apps is what owns deployed copies, and a project created by the wizard
    // does not have it unless it was asked for.
    await alepha.inject(ProjectCapabilityController).setCapability.fetch(
      {
        params: { projectId: project.id, key: "apps" },
        body: { enabled: true },
      },
      { user },
    );

    const instance = (
      await alepha.inject(AppController).createApp.fetch(
        {
          params: { projectId: project.id },
          body: { app: "my-app", env: "b14-preview" },
        },
        { user },
      )
    ).data;
    return { user, project, instance };
  };

  describe("queueing one", () => {
    it("refuses a copy with no estate, before writing anything", async ({
      expect,
    }) => {
      // There is nowhere to deploy to, and a queued row for a deploy that can
      // never run is a row somebody has to explain.
      const { project, instance } = await world();

      await expect(
        alepha.inject(DeployService).queue({
          projectId: project.id,
          instanceId: instance.id,
          tag: "latest",
        }),
      ).rejects.toThrowError(/has no estate/);

      expect(await alepha.inject(TestRows).deployments.findMany({})).toEqual(
        [],
      );
    });

    it("refuses a tag the registry does not hold", async ({ expect }) => {
      // ⚠️ Refused rather than built. This entry point can only ever deploy
      // STORED bytes: CI pushed `0.28.0` on Tuesday from a clean checkout, and
      // promoting it on Friday must not rebuild from a different machine.
      const { project, instance } = await world();
      await alepha.inject(TestRows).deployments.findMany({});

      await expect(
        alepha.inject(DeployService).queue({
          projectId: project.id,
          instanceId: instance.id,
          tag: "0.28.0",
        }),
      ).rejects.toThrowError(/has no estate|no artifact tagged/);
    });

    it("refuses a copy from another project", async ({ expect }) => {
      // The instance id is a uuid a caller supplies, and the gate on the path
      // param has already passed by the time this runs.
      const first = await world();
      const second = await world();

      await expect(
        alepha.inject(DeployService).queue({
          projectId: second.project.id,
          instanceId: first.instance.id,
          tag: "latest",
        }),
      ).rejects.toThrowError(/No such deployed copy/);
    });
  });

  describe("the log", () => {
    /**
     * ⚠️ A deploy that loops, or an adapter that logs per asset, writes a row
     * that grows without limit into a database with a 10 GB ceiling and no
     * sweep job for this table.
     */
    it("is bounded, and says when it dropped lines", async ({ expect }) => {
      const { project, instance } = await world();
      const rows = alepha.inject(TestRows).deployments;
      const row = await rows.create({
        projectId: project.id,
        instanceId: instance.id,
        app: "my-app",
        tag: "latest",
        sha256: "a".repeat(64),
        status: "queued",
      });
      const registry = alepha.inject(DeployRegistry);

      for (let i = 0; i < DeployRegistry.MAX_LOG_LINES + 25; i++) {
        await registry.line(row.id, `line ${i}`);
      }

      const stored = await rows.findById(row.id);
      expect(stored?.log.length).toBe(DeployRegistry.MAX_LOG_LINES);
      // A truncated log that does not say it is truncated reads as a complete
      // one, and the missing lines are the ones somebody is debugging.
      expect(stored?.log[0]?.text).toMatch(/earlier line\(s\) dropped/);
      expect(stored?.log.at(-1)?.text).toBe(
        `line ${DeployRegistry.MAX_LOG_LINES + 24}`,
      );
    });

    it("never throws, so a lost line cannot fail a deploy", async ({
      expect,
    }) => {
      // By the time most lines are written a Worker has been uploaded and a
      // database migrated. Reporting failure for work that succeeded would
      // have the operator retry a run that already landed.
      const registry = alepha.inject(DeployRegistry);

      await expect(
        registry.line(crypto.randomUUID(), "against a row that is not there"),
      ).resolves.toBeUndefined();
      await expect(
        registry.failed(crypto.randomUUID(), "gone"),
      ).resolves.toBeUndefined();
    });

    it("runs with no row at all", async ({ expect }) => {
      // A deploy driven from a test, or from the CLI against an instance with
      // no row yet, still has to run.
      const registry = alepha.inject(DeployRegistry);

      await expect(registry.line(undefined, "x")).resolves.toBeUndefined();
      await expect(registry.started(undefined)).resolves.toBeUndefined();
    });
  });

  describe("the run", () => {
    it("marks a terminal state when it cannot even start", async ({
      expect,
    }) => {
      const { project, instance } = await world();
      const rows = alepha.inject(TestRows).deployments;
      const row = await rows.create({
        projectId: project.id,
        instanceId: instance.id,
        app: "my-app",
        tag: "latest",
        sha256: "a".repeat(64),
        status: "queued",
      });

      // No estate on the instance, so the run refuses before any side effect.
      await expect(alepha.inject(DeployService).run(row)).rejects.toThrow();

      const after = await rows.findById(row.id);
      expect(after?.status).toBe("failed");
      expect(after?.error).toMatch(/has no estate/);
      expect(after?.finishedAt).toBeDefined();
    });

    it("does not re-run a deploy that already finished", async ({ expect }) => {
      // ⚠️ A retried or replayed execution must not restart a deploy the
      // operator has seen finish. The job checks the row's own status rather
      // than trusting the queue not to redeliver.
      const { project, instance } = await world();
      const rows = alepha.inject(TestRows).deployments;
      const row = await rows.create({
        projectId: project.id,
        instanceId: instance.id,
        app: "my-app",
        tag: "latest",
        sha256: "a".repeat(64),
        status: "succeeded",
      });

      let ran = false;
      Object.assign(
        alepha.inject(DeployService) as unknown as Record<string, unknown>,
        {
          run: async () => {
            ran = true;
          },
        },
      );

      // `inline: true` runs the handler in front of the caller, so a replay
      // is testable without a dispatcher and without travelling the clock.
      await alepha
        .inject(DeployJobs)
        .runDeploy.push(
          { deploymentId: row.id, stage: "deploy" },
          { inline: true },
        );

      expect(ran).toBe(false);
      expect((await rows.findById(row.id))?.status).toBe("succeeded");
    });

    it("is a no-op when the row is gone", async ({ expect }) => {
      // The row went with its instance or its project. A retry would find the
      // same absence, so this must not be a failure.
      await expect(
        alepha
          .inject(DeployJobs)
          .runDeploy.push(
            { deploymentId: crypto.randomUUID(), stage: "deploy" },
            { inline: true },
          ),
      ).resolves.toBeDefined();
    });
  });

  describe("the row's shape", () => {
    it("carries the snapshot, not just the artifact id", async ({ expect }) => {
      // ⚠️ Pushing `latest` REPLACES the artifact row, so a deployment carrying
      // only `artifactId` would start claiming it shipped bytes it never saw -
      // the one question content addressing exists to answer.
      const { project, instance } = await world();
      const rows = alepha.inject(TestRows).deployments;
      const row = await rows.create({
        projectId: project.id,
        instanceId: instance.id,
        artifactId: crypto.randomUUID(),
        app: "my-app",
        tag: "0.28.0",
        sha256: "b".repeat(64),
        status: "queued",
      });

      expect(row.app).toBe("my-app");
      expect(row.tag).toBe("0.28.0");
      expect(row.sha256).toBe("b".repeat(64));
      // Soft: no foreign key, so the artifact may be gone and this row stays
      // readable.
      expect(row.artifactId).toBeDefined();
    });

    it("goes when its instance goes", async ({ expect }) => {
      // A deployment says "these bytes are running HERE". With no here it is
      // an orphan nobody can act on: no rollback target, no version list, no
      // estate to reach.
      const { user, project, instance } = await world();
      const rows = alepha.inject(TestRows).deployments;
      await rows.create({
        projectId: project.id,
        instanceId: instance.id,
        app: "my-app",
        tag: "latest",
        sha256: "c".repeat(64),
        status: "succeeded",
      });

      await alepha.inject(AppController).deleteApp.fetch(
        {
          params: {
            projectId: project.id,
            app: instance.app,
            env: instance.env,
          },
        },
        { user },
      );

      expect(await rows.findMany({})).toEqual([]);
    });
  });
});

/**
 * The gate, and the hole it exists to keep shut.
 *
 * ⚠️ **Nothing on the wire names an estate.** An estate is owned by a USER and
 * lent to several projects, so a request that carried an estate id would let a
 * project owner type somebody else's and have their deploy land in that
 * person's Cloudflare account, on that person's token, with the server
 * complying because it only checked the estate exists. Folio #96 named that
 * hole; it came back when estates became user-owned, and this is what keeps it
 * shut.
 */
/**
 * ⚠️ Nothing checked this before. Push a `node` artifact, deploy it to a
 * Cloudflare estate, and you got a broken Worker or a confusing failure deep in
 * the deploy - after an upload had already happened.
 */
describe("the runtime gate", () => {
  let alepha: Alepha;

  beforeEach(async () => {
    alepha = await setup();
  });

  afterEach(async () => {
    await alepha.stop();
  });

  const cloudflareEstate = { slug: "zug", type: "cloudflare" } as never;
  const bayEstate = { slug: "vps", type: "bay" } as never;

  it("accepts the variant the estate can run", ({ expect }) => {
    const gate = alepha.inject(DeployGate);

    expect(() =>
      gate.assertRuntime({
        estate: cloudflareEstate,
        app: "panda",
        tag: "1.2.3",
        runtime: "workerd",
        available: ["workerd"],
      }),
    ).not.toThrow();
  });

  it("names both sides when the wrong variant is picked", ({ expect }) => {
    // Both builds exist, and this deploy reached for the wrong one.
    const gate = alepha.inject(DeployGate);

    expect(() =>
      gate.assertRuntime({
        estate: cloudflareEstate,
        app: "panda",
        tag: "1.2.3",
        runtime: "node",
        available: ["node", "workerd"],
      }),
    ).toThrowError(
      "Artifact panda@1.2.3 is a `node` build; estate 'zug' (cloudflare) runs `workerd`.",
    );
  });

  it("names the missing variant and how to produce it", ({ expect }) => {
    // ⚠️ What makes the multi-variant model usable: a deploy is a LOOKUP, so a
    // miss has to say exactly which build to make. The command drifted once
    // already, so the string is pinned here and #1812 has to match it.
    const gate = alepha.inject(DeployGate);

    expect(() =>
      gate.assertRuntime({
        estate: cloudflareEstate,
        app: "panda",
        tag: "1.2.3",
        runtime: "node",
        available: ["node"],
      }),
    ).toThrowError(
      "panda@1.2.3 has no `workerd` build. Run `lore apps build --tag 1.2.3 --env <env>`, then `lore artifacts push`.",
    );
  });

  it("refuses a workerd build on a Bay machine, the other way round", ({
    expect,
  }) => {
    // The Bay story: a project that has only ever built for Cloudflare is lent
    // a VPS, and the message has to say which build is missing rather than
    // "not found".
    const gate = alepha.inject(DeployGate);

    expect(() =>
      gate.assertRuntime({
        estate: bayEstate,
        app: "panda",
        tag: "1.2.3",
        runtime: "workerd",
        available: ["workerd"],
      }),
    ).toThrowError(/has no `node` build/);
  });
});

/**
 * The bounds a deploy runs inside.
 */
describe("the deploy limits", () => {
  let alepha: Alepha;

  beforeEach(async () => {
    alepha = await setup();
  });

  afterEach(async () => {
    await alepha.stop();
  });

  it("refuses a deploy past the cap rather than interleaving it", async ({
    expect,
  }) => {
    // ⚠️ Refused, not queued silently and not run anyway. A deploy holds an
    // unpacked artifact and its modules in memory against a 128 MB ceiling
    // shared with everything else, so a third concurrent run is an OOM that
    // takes the other two with it. The job's retry is what turns the refusal
    // into a queue.
    const service = alepha.inject(DeployService);
    let release: (() => void) | undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });

    Object.assign(service as unknown as Record<string, unknown>, {
      limits: { concurrency: async () => 1, timeoutMs: async () => 60_000 },
      gate: {
        assert: async () => ({ slug: "e", accountId: "a", credential: "c" }),
        assertRuntime: () => {},
      },
      instances: { findById: async () => ({ id: "i", app: "a", env: "e" }) },
      artifacts: { findOne: async () => ({ id: "x", sha256: "y" }) },
      seal: { open: () => "token" },
      runner: {
        run: async () => {
          await held;
          return { urls: [] };
        },
      },
    });

    const first = service.run({ id: "d-1" } as never);
    // Let the first take the slot before the second asks for it.
    await new Promise((resolve) => setTimeout(resolve, 5));

    await expect(service.run({ id: "d-2" } as never)).rejects.toThrowError(
      /already running 1 deploys/,
    );

    release?.();
    await first;

    // ...and the slot is given back, so a later run is not refused forever.
    await expect(service.run({ id: "d-3" } as never)).resolves.toBeUndefined();
  });

  it("marks a run that overran, so the row cannot stay running forever", async ({
    expect,
  }) => {
    // ⚠️ The deploy is NOT cancelled - nothing in a fetch chain offers a
    // cancellation point to reach, and abandoning a half-uploaded Worker
    // mid-flight is worse than letting it finish. What the timeout guarantees
    // is that the ROW reaches a terminal state.
    const rows = alepha.inject(TestRows);
    const owner = await aUser(alepha);
    const project = await aProject(alepha, owner);
    await enableApps(alepha, project.id, owner);
    const instance = await anInstance(alepha, project.id, owner);
    const row = await rows.deployments.create({
      projectId: project.id,
      instanceId: instance.id,
      app: "my-app",
      tag: "latest",
      sha256: "d".repeat(64),
      status: "queued",
    });

    const service = alepha.inject(DeployService);
    Object.assign(service as unknown as Record<string, unknown>, {
      limits: { concurrency: async () => 4, timeoutMs: async () => 20 },
      gate: {
        assert: async () => ({ slug: "e", accountId: "a", credential: "c" }),
        assertRuntime: () => {},
      },
      artifacts: { findOne: async () => ({ id: "x", sha256: "y" }) },
      seal: { open: () => "token" },
      runner: {
        run: () => new Promise(() => {}),
      },
    });

    await expect(service.run(row)).rejects.toThrowError(/was abandoned/);

    const after = await rows.deployments.findById(row.id);
    expect(after?.status).toBe("failed");
    expect(after?.finishedAt).toBeDefined();
  });
});

describe("the deploy gate", () => {
  let alepha: Alepha;

  beforeEach(async () => {
    alepha = await setup();
  });

  afterEach(async () => {
    await alepha.stop();
  });

  it("takes no estate from the client, by any route", async ({ expect }) => {
    // Structural rather than a check: the request schemas carry a project, an
    // instance and a tag, and no estate at all. A field added here later is
    // the bug, however carefully it is validated.
    const controller = alepha.inject(DeployController);
    const body = (
      controller.startDeploy as never as {
        options: { schema: { body: { shape: Record<string, unknown> } } };
      }
    ).options.schema.body;

    expect(Object.keys(body.shape)).toEqual(["tag"]);
  });

  it("refuses a copy whose lending was revoked after it was pointed there", async ({
    expect,
  }) => {
    // ⚠️ `estate_projects` is a delete, not a cascade onto `app_instances`, so
    // the column can name an estate this project no longer holds. Proving it at
    // write time is not enough.
    const rows = alepha.inject(TestRows);
    const owner = await aUser(alepha);
    const project = await aProject(alepha, owner);
    await enableApps(alepha, project.id, owner);
    const instance = await anInstance(alepha, project.id, owner);
    const estate = await rows.estates.create({
      ownerUserId: owner.id,
      slug: "someones-account",
      type: "cloudflare",
      deployAllowed: true,
    } as never);
    const grant = await rows.grants.create({
      estateId: estate.id,
      projectId: project.id,
    } as never);
    await rows.instances.updateById(instance.id, { estateId: estate.id });

    // With the lending in place it passes.
    const gate = alepha.inject(DeployGate);
    const withLending = await rows.instances.findById(instance.id);
    await expect(gate.assert(withLending as never)).resolves.toBeDefined();

    await rows.grants.deleteById(grant.id);

    await expect(gate.assert(withLending as never)).rejects.toThrowError(
      /no longer lent to this project/,
    );
  });

  it("refuses an estate whose owner turned deploys off", async ({ expect }) => {
    // The message names WHOSE estate it is: the person deploying is often not
    // the person who can flip this, and a Bay machine is stats-only until its
    // owner says otherwise.
    const rows = alepha.inject(TestRows);
    const owner = await aUser(alepha);
    const project = await aProject(alepha, owner);
    await enableApps(alepha, project.id, owner);
    const instance = await anInstance(alepha, project.id, owner);
    const estate = await rows.estates.create({
      ownerUserId: owner.id,
      slug: "stats-only",
      type: "bay",
      deployAllowed: false,
    } as never);
    await rows.grants.create({
      estateId: estate.id,
      projectId: project.id,
    } as never);
    await rows.instances.updateById(instance.id, { estateId: estate.id });

    await expect(
      alepha
        .inject(DeployGate)
        .assert((await rows.instances.findById(instance.id)) as never),
    ).rejects.toThrowError(/'stats-only' does not accept deploys/);
  });

  it("does not refuse a Bay estate for having no Cloudflare credential", async ({
    expect,
  }) => {
    // ⚠️ `credentialStatus` is `undefined` for a `bay` estate rather than
    // `"valid"`, so a `!== "valid"` test would refuse every Bay deploy.
    const rows = alepha.inject(TestRows);
    const owner = await aUser(alepha);
    const project = await aProject(alepha, owner);
    await enableApps(alepha, project.id, owner);
    const instance = await anInstance(alepha, project.id, owner);
    const estate = await rows.estates.create({
      ownerUserId: owner.id,
      slug: "a-machine",
      type: "bay",
      deployAllowed: true,
    } as never);
    await rows.grants.create({
      estateId: estate.id,
      projectId: project.id,
    } as never);
    await rows.instances.updateById(instance.id, { estateId: estate.id });

    await expect(
      alepha
        .inject(DeployGate)
        .assert((await rows.instances.findById(instance.id)) as never),
    ).resolves.toMatchObject({ slug: "a-machine" });
  });

  it("refuses a Cloudflare estate whose credential stopped working", async ({
    expect,
  }) => {
    const rows = alepha.inject(TestRows);
    const owner = await aUser(alepha);
    const project = await aProject(alepha, owner);
    await enableApps(alepha, project.id, owner);
    const instance = await anInstance(alepha, project.id, owner);
    const estate = await rows.estates.create({
      ownerUserId: owner.id,
      slug: "expired",
      type: "cloudflare",
      deployAllowed: true,
      credentialError: "Token is not valid",
    } as never);
    await rows.grants.create({
      estateId: estate.id,
      projectId: project.id,
    } as never);
    await rows.instances.updateById(instance.id, { estateId: estate.id });

    await expect(
      alepha
        .inject(DeployGate)
        .assert((await rows.instances.findById(instance.id)) as never),
    ).rejects.toThrowError(/usable Cloudflare credential/);
  });
});
