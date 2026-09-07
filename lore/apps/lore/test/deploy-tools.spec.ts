import { Alepha } from "alepha";
import { AlephaApiUsers, UserService } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { AlephaFake } from "alepha/fake";
import { AlephaMcp } from "alepha/mcp";
import { $repository, AlephaOrm } from "alepha/orm";
import { AlephaSecurity, currentUserAtom } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { describe, expect, it } from "vitest";

import { AppController } from "../src/api/controllers/AppController.ts";
import { ProjectController } from "../src/api/controllers/ProjectController.ts";
import { deployments } from "../src/api/entities/deployments.ts";
import { LoreApi } from "../src/api/index.ts";
import { LoreMcp } from "../src/mcp/index.ts";
import { AppInstanceTools } from "../src/mcp/tools/AppInstanceTools.ts";
import { DeployTools } from "../src/mcp/tools/DeployTools.ts";

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
  alepha.with(LoreApi);
  alepha.with(LoreMcp);

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
      alepha.store.set(currentUserAtom, { id: userId, roles: ["user"] } as any);
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
    } as any),
  );

  const instance = await asUser(OWNER, () =>
    appApi.createApp({
      params: { projectId: project.id },
      body: { app: "club", env: "production" },
    } as any),
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
  };
};

describe("Lore MCP - deploys", () => {
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
      const description = String(
        (deployTools.deploy_start as any).options.description,
      );

      expect(description).toContain("latest");
      expect(description).toMatch(/bytes may be replaced/);
      expect(description).toMatch(/Nothing here builds/);
    });
  });

  describe("naming a copy", () => {
    it("refuses a pair with no instance, and creates nothing", async () => {
      // Minting a deploy target as a side effect of a typo in `env` is how
      // `clbu` gets deployed to.
      const { deployTools, instanceTools, project, call } = await setup();

      await expect(
        call(deployTools.deploy_start, {
          project: project.id,
          app: "club",
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
          app: "club",
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
        app: "club",
        tag: "0.28.0",
        sha256: "a".repeat(64),
        status: "succeeded",
        log: [{ at: "2026-09-07T00:00:00.000Z", text: "live" }],
      } as never);

      const read: any = await call(deployTools.deploy_status, {
        project: project.id,
        app: "club",
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
          app: "club",
          env: "production",
        }),
      ).rejects.toThrow(/never been deployed/);
    });
  });
});
