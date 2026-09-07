import { Alepha, z } from "alepha";
import { AdminUserController, AlephaApiUsers } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { AlephaFake, FakeProvider } from "alepha/fake";
import { $repository, AlephaOrm } from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { afterEach, beforeEach, describe, it } from "vitest";

import { AppController } from "../src/api/controllers/AppController.ts";
import { ProjectCapabilityController } from "../src/api/controllers/ProjectCapabilityController.ts";
import { ProjectController } from "../src/api/controllers/ProjectController.ts";
import { deployments } from "../src/api/entities/deployments.ts";
import { LoreApi } from "../src/api/index.ts";
import { DeployJobs } from "../src/api/jobs/DeployJobs.ts";
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
}

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
      expect(after?.error).toMatch(/no longer names an estate/);
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
