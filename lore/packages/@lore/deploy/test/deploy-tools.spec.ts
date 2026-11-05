import { ProjectController, ProjectSecurityService } from "@lore/core/api";
import { Alepha } from "alepha";
import { RankService } from "alepha/api/organizations";
import { AlephaApiUsers, UserService } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { AlephaMcp } from "alepha/mcp";
import { $repository, AlephaOrm } from "alepha/orm";
import { AlephaSecurity, currentUserAtom } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { AlephaFake } from "alepha/testing/faker";
import { describe, expect, it } from "vitest";

import { AppController } from "../src/api/index.ts";
import { LoreDeployApi } from "../src/api/index.ts";
import { LoreDeployMcp } from "../src/mcp/index.ts";
import { AppInstanceTools, DeployTools } from "../src/mcp/index.ts";
import {
  appInstances,
  artifacts,
  deployments,
  estateProjects,
  estates,
} from "../src/schemas/index.ts";
import { createTestMemberByProjectId } from "../src/testing/index.ts";

/**
 * Shipping from a conversation.
 *
 * ⚠️ **The load-bearing property is what these tools do NOT take.** No estate
 * argument, on any of them: an agent that could name an estate could deploy
 * into somebody else's cloud account, which is the hole folio #96 named. And
 * no tool creates an instance as a side effect of naming one.
 */
class Probe {
  deployments = $repository(deployments);
  estates = $repository(estates);
  grants = $repository(estateProjects);
  instances = $repository(appInstances);
  artifacts = $repository(artifacts);
}

const setup = async () => {
  const alepha = Alepha.create({
    env: {
      LOG_LEVEL: "error",
      SERVER_PORT: 0,
      DATABASE_URL: ":memory:",
      APP_SECRET: "a-strong-and-unique-app-secret-for-tests",
    },
  });
  alepha.with(AlephaOrm);
  alepha.with(AlephaServer);
  alepha.with(AlephaSecurity);
  alepha.with(AlephaEmail);
  alepha.with(AlephaApiUsers);
  alepha.with(AlephaFake);
  alepha.with(AlephaMcp);
  alepha.with(LoreDeployApi);
  alepha.with(LoreDeployMcp);

  const probe = alepha.inject(Probe);
  const deployTools = alepha.inject(DeployTools);
  const instanceTools = alepha.inject(AppInstanceTools);
  const projectApi = alepha.inject(ProjectController);
  const appApi = alepha.inject(AppController);
  const users = alepha.inject(UserService);
  await alepha.start();

  const owner = await users.createUser({ username: "owner" });
  const OWNER = owner.id;

  const asUser = <R>(userId: string, fn: () => R): R =>
    alepha.context.run(() => {
      alepha.store.set(currentUserAtom, { id: userId, roles: ["user"] });
      return fn();
    });

  const call = (tool: any, params: Record<string, unknown>, userId = OWNER) =>
    asUser(userId, () => tool.execute(params));

  const project = await asUser(OWNER, () =>
    projectApi.createProject({
      body: {
        title: "Shipyard",
        // ⚠️ `deploy`, not `track`: the write tools take that option, and a
        // project with telemetry on and deploys off must not reach them.
        capabilities: [{ key: "apps", options: { deploy: true } }],
      },
    }),
  );

  const instance = await asUser(OWNER, () =>
    appApi.createApp({
      params: { projectId: project.id },
      body: { app: "acme", env: "production" },
    }),
  );

  return {
    alepha,
    probe,
    deployTools,
    instanceTools,
    project,
    instance,
    call,
    OWNER,
    owner,
    users,
  };
};

describe("Lore MCP - deploys", () => {
  describe("who may deploy", () => {
    /**
     * A copy on a lent Bay estate, with one stored build and one run that
     * succeeded, so `deploy_start` and `deploy_rollback` both reach their
     * write. Bay keeps no version history, so a rollback redeploys that build.
     *
     * ⚠️ Without the estate the rollback's plan refuses first, for a caller who
     * holds `app:read` alone: the spec would pass and prove nothing about
     * `deploy:manage`.
     */
    const shippable = async () => {
      const world = await setup();
      const { alepha, probe, project, instance, owner, users } = world;

      const estate = await probe.estates.create({
        ownerUserId: owner.id,
        type: "bay",
        slug: "bay-shipyard",
        deployAllowed: true,
        credentialStatus: "valid",
      } as never);
      await probe.grants.create({ estateId: estate.id, projectId: project.id });
      await probe.instances.updateById(instance.id, { estateId: estate.id });
      await probe.artifacts.create({
        projectId: project.id,
        app: "acme",
        tag: "0.28.0",
        runtime: "node",
        format: "archive",
        sha256: "a".repeat(64),
        size: 10,
        fileId: crypto.randomUUID(),
      });
      const run = await probe.deployments.create({
        projectId: project.id,
        instanceId: instance.id,
        app: "acme",
        tag: "0.28.0",
        sha256: "a".repeat(64),
        status: "succeeded",
      });

      const shipper = await users.createUser({ username: "shipper" });
      await alepha.inject(RankService).save(
        await alepha
          .inject(ProjectSecurityService)
          .organizationIdOf(project.id),
        {
          key: "shipper",
          name: "Shipper",
          permissions: ["project:read", "app:read", "deploy:manage"],
        },
        { id: owner.id, roles: ["user"] },
      );
      await createTestMemberByProjectId(alepha, project.id, shipper.id, {
        rank: "shipper",
      });
      const member = await users.createUser({ username: "member" });
      await createTestMemberByProjectId(alepha, project.id, member.id);

      return { ...world, run, shipper, member };
    };

    it("is whoever holds deploy:manage, not only the owner", async () => {
      const { deployTools, project, run, shipper, call } = await shippable();

      const started: any = await call(
        deployTools.deploy_start,
        { project: project.id, app: "acme", env: "production", tag: "0.28.0" },
        shipper.id,
      );
      expect(started.id).toBeTruthy();

      const back: any = await call(
        deployTools.deploy_rollback,
        { project: project.id, deployment: run.id },
        shipper.id,
      );
      expect(back.path).toBe("artifact");
    });

    it("refuses a rank without it", async () => {
      const { deployTools, project, run, member, call } = await shippable();

      await expect(
        call(
          deployTools.deploy_start,
          {
            project: project.id,
            app: "acme",
            env: "production",
            tag: "0.28.0",
          },
          member.id,
        ),
      ).rejects.toThrow(/deploy:manage/);
      await expect(
        call(
          deployTools.deploy_rollback,
          { project: project.id, deployment: run.id },
          member.id,
        ),
      ).rejects.toThrow(/deploy:manage/);
    });

    it("is what the tools tell an agent", async () => {
      const { deployTools } = await setup();

      for (const tool of [
        deployTools.deploy_start,
        deployTools.deploy_rollback,
      ]) {
        expect(tool.options.description).toContain("Needs `deploy:manage`");
        expect(tool.options.description).not.toContain("owner only");
      }
    });
  });

  describe("what the surface is, and is not", () => {
    it("adds three deploy tools and no estate tool", async () => {
      // ⚠️ An estate is owned by a USER and lent to projects, so it is not a
      // project resource an agent lists - and `app_instance_list` already
      // answers which one a copy deploys to. A credential grant was never to
      // be initiated from MCP, and no tool here goes near one.
      const { deployTools } = await setup();

      const names = Object.keys(deployTools).filter((key) =>
        key.startsWith("deploy_"),
      );
      expect(names.sort()).toEqual([
        "deploy_rollback",
        "deploy_start",
        "deploy_status",
      ]);
      expect(names.some((name) => name.includes("estate"))).toBe(false);
      // And no second artifact tool: `ArtifactTools` already ships the pair.
      expect(names.some((name) => name.includes("artifact"))).toBe(false);
    });

    it("takes no estate argument on any tool", async ({ expect }) => {
      const { deployTools } = await setup();

      for (const tool of [
        deployTools.deploy_start,
        deployTools.deploy_status,
        deployTools.deploy_rollback,
      ]) {
        const keys = Object.keys(
          (tool as any).options.schema.params.shape ?? {},
        );
        // ⚠️ Asserted non-empty first, or every check below passes for a
        // schema this test failed to reach.
        expect(keys).toContain("project");
        expect(keys).not.toContain("estate");
        expect(keys.some((key) => key.includes("estate"))).toBe(false);
      }
    });

    it("says in deploy_start's own description what an omitted tag means", async ({
      expect,
    }) => {
      // ⚠️ The description IS the interface. Without this sentence an agent
      // omits the tag, deploys `latest`, and promotes whatever CI pushed last
      // rather than a version somebody chose.
      const { deployTools } = await setup();
      const description = String(deployTools.deploy_start.options.description);

      expect(description).toContain("latest");
      expect(description).toMatch(/bytes may be replaced/);
      expect(description).toMatch(/Nothing here builds/);
    });
  });

  describe("naming a copy", () => {
    it("refuses a pair with no instance, and creates nothing", async () => {
      // Minting a deploy target as a side effect of a typo in `env` is how
      // `acem` gets deployed to.
      const { deployTools, instanceTools, project, call } = await setup();

      await expect(
        call(deployTools.deploy_start, {
          project: project.id,
          app: "acme",
          env: "prod",
        }),
      ).rejects.toThrow();

      const listed: any = await call(instanceTools.app_instance_list, {
        project: project.id,
      });
      expect(
        listed.instances.map((it: { env: string }) => it.env).sort(),
      ).toEqual(["production"]);
    });

    it("refuses a copy with no estate, naming what is missing", async () => {
      // The gate's own words. The instance exists; it has nowhere to go.
      const { deployTools, project, call } = await setup();

      await expect(
        call(deployTools.deploy_start, {
          project: project.id,
          app: "acme",
          env: "production",
        }),
      ).rejects.toThrow(/has no estate/);
    });
  });

  describe("reading a run", () => {
    it("answers the newest run of a copy named by its pair", async () => {
      const { deployTools, probe, project, instance, call } = await setup();

      await probe.deployments.create({
        projectId: project.id,
        instanceId: instance.id,
        app: "acme",
        tag: "0.28.0",
        sha256: "a".repeat(64),
        status: "succeeded",
        log: [{ at: "2026-09-07T00:00:00.000Z", text: "live" }],
      });

      const read: any = await call(deployTools.deploy_status, {
        project: project.id,
        app: "acme",
        env: "production",
      });

      expect(read.tag).toBe("0.28.0");
      expect(read.status).toBe("succeeded");
      // The log is a list of strings, not of rows: an agent reads what
      // happened, not when each line was appended.
      expect(read.log).toEqual(["live"]);
    });

    it("says a copy has never been deployed rather than answering nothing", async () => {
      const { deployTools, project, call } = await setup();

      await expect(
        call(deployTools.deploy_status, {
          project: project.id,
          app: "acme",
          env: "production",
        }),
      ).rejects.toThrow(/never been deployed/);
    });
  });
});
