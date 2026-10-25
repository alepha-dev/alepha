import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { Alepha } from "alepha";
import { NodeHttpServerProvider } from "alepha/server";
import { afterEach, beforeEach, describe, it } from "vitest";

import {
  EstateCommandService,
  EstateController,
  RegistryCredentialController,
  StackController,
  StackDeployController,
  StackVariableController,
} from "../src/api/index.ts";
import { estateCommandFrameSchema } from "../src/api/schemas/estateCommandFrameSchema.ts";
import { stackDeployOutcomeSchema } from "../src/schemas/index.ts";
import {
  bootStackSpec,
  createEnvironment,
  createStack,
  stackWorld,
  type StackWorld,
} from "./support/stackWorld.ts";

/**
 * Stack deploys to a Bay estate over the connector (#Q2694).
 *
 * `test/fixtures/bay/wire-v2/` is Bay's `internal/connector/testdata/stacks`:
 * the frame Lore queues has the shape of Bay's `command-stack-deploy.json`,
 * and what the machine uploads is Bay's `outcome-stack-deploy.json`.
 */
const wire = (name: string) =>
  JSON.parse(
    readFileSync(
      join(import.meta.dirname, "fixtures/bay/wire-v2", name),
      "utf8",
    ),
  );

const umami = readFileSync(
  join(
    import.meta.dirname,
    "fixtures/bay/compose/accepted/app-stack/compose.yml",
  ),
  "utf8",
);

describe("stack deploys", () => {
  let alepha: Alepha;

  beforeEach(async () => {
    alepha = await bootStackSpec();
  });

  afterEach(async () => {
    await alepha.stop();
  });

  /**
   * An enrolled Bay lent to the project, a stack on it with a production
   * environment, a route, its variables, a registry credential and one
   * revision.
   */
  const arrange = async (
    options: { deployAllowed?: boolean; variables?: boolean } = {},
  ) => {
    const w = await stackWorld(alepha);
    const minted = (
      await alepha
        .inject(EstateController)
        .createEstate.fetch(
          { body: { slug: `bay-${crypto.randomUUID().slice(0, 6)}` } },
          { user: w.user },
        )
    ).data;
    await w.rows.estates.updateById(minted.id, {
      deployAllowed: options.deployAllowed ?? true,
    });
    await w.rows.grants.create({
      estateId: minted.id,
      projectId: w.project.id,
    } as never);
    const stack = await createStack(alepha, w, {
      name: "shop",
      estateId: minted.id,
    });
    const env = await createEnvironment(alepha, w, stack.id, {
      env: "production",
      baseDomain: "shop.example.test",
    });
    const params = {
      projectId: w.project.id,
      stackId: stack.id,
      environmentId: env.id,
    };
    await alepha
      .inject(StackController)
      .addStackRoute.fetch(
        { params, body: { service: "api", domain: "api.example.test" } },
        { user: w.user },
      );
    if (options.variables ?? true) {
      await alepha.inject(StackVariableController).setStackVariable.fetch(
        {
          params,
          body: { key: "DB_PASSWORD", value: "production-db-password" },
        },
        { user: w.user },
      );
    }
    await alepha
      .inject(RegistryCredentialController)
      .setRegistryCredential.fetch(
        {
          params: { projectId: w.project.id },
          body: {
            host: "harbor.corp.test",
            username: "ci",
            secret: "registry-token",
          },
        },
        { user: w.user },
      );
    const revision = await upload(w, stack.id, umami);
    return {
      w,
      estateId: minted.id,
      secret: minted.secret as string,
      stack,
      env,
      params,
      revision,
    };
  };

  const upload = async (w: StackWorld, stackId: string, text: string) =>
    (
      await alepha.inject(StackController).uploadStackRevision.fetch(
        {
          params: { projectId: w.project.id, stackId },
          body: { file: new File([text], "compose.yml") },
        },
        { user: w.user },
      )
    ).data;

  const deploy = (w: StackWorld, params: object, revision?: number) =>
    alepha
      .inject(StackDeployController)
      .deployStackEnvironment.fetch({ params, body: { revision } } as never, {
        user: w.user,
      });

  const pull = async (
    secret: string,
    commandId: string,
    what: string,
    init: { method?: string; body?: string } = {},
  ) => {
    const base = alepha.inject(NodeHttpServerProvider).hostname;
    const headers: Record<string, string> = {
      authorization: `Bearer ${secret}`,
    };
    if (init.body) {
      headers["content-type"] = "application/json";
    }
    return await fetch(`${base}/estates/commands/${commandId}/${what}`, {
      method: init.method ?? "GET",
      body: init.body,
      headers,
    });
  };

  const running = async (w: StackWorld, commandId: string) => {
    await w.rows.commands.updateById(commandId, { status: "running" });
  };

  describe("dispatch", () => {
    it("queues one stack-deploy whose frame has the shape of Bay's fixture", async ({
      expect,
    }) => {
      const { w, params, revision } = await arrange();
      const deployed = (await deploy(w, params)).data;
      const command = await w.rows.commands.getOne({
        where: { id: { eq: deployed.commandId } },
      });
      const frame = alepha.inject(EstateCommandService).frameOf(command);

      const fixture = wire("command-stack-deploy.json");
      expect(estateCommandFrameSchema.parse(fixture).kind).toBe("stack-deploy");
      expect(Object.keys(fixture).sort()).toEqual(Object.keys(frame).sort());
      expect(frame).toMatchObject({
        kind: "stack-deploy",
        app: "",
        stack: "shop",
        environment: "production",
        artifact: {
          id: revision.id,
          sha256: revision.sha256,
          size: revision.size,
        },
        routes: [{ service: "api", domain: "api.example.test" }],
        baseDomain: "shop.example.test",
      });
      expect(JSON.stringify(command.payload)).not.toContain(
        "production-db-password",
      );
      expect(deployed).toMatchObject({ status: "queued", revision: 1 });
    });

    it("refuses before anything is queued while the estate does not accept deploys, or a variable is unset", async ({
      expect,
    }) => {
      const off = await arrange({ deployAllowed: false });
      await expect(deploy(off.w, off.params)).rejects.toThrow(
        "does not accept deploys",
      );
      const unset = await arrange({ variables: false });
      await expect(deploy(unset.w, unset.params)).rejects.toThrow(
        "has no value for DB_PASSWORD",
      );
      expect(await off.w.rows.commands.findMany({})).toEqual([]);
    });
  });

  describe("what the machine pulls, by command id", () => {
    it("gets its bundle, its environment's variables and its project's registry credentials", async ({
      expect,
    }) => {
      const { w, secret, params, revision } = await arrange();
      const deployed = (await deploy(w, params)).data;
      await running(w, deployed.commandId);

      const bundle = await pull(secret, deployed.commandId, "artifact");
      expect(bundle.status).toBe(200);
      expect(bundle.headers.get("x-artifact-sha256")).toBe(revision.sha256);
      const bytes = new Uint8Array(await bundle.arrayBuffer());
      const digest = [
        ...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
      ]
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
      expect(digest).toBe(revision.sha256);

      expect(
        await (await pull(secret, deployed.commandId, "secrets")).json(),
      ).toEqual({
        DB_PASSWORD: "production-db-password",
      });
      const registries = await (
        await pull(secret, deployed.commandId, "registries")
      ).json();
      expect(registries).toEqual([
        {
          host: "harbor.corp.test",
          username: "ci",
          password: "registry-token",
        },
      ]);
      expect(wire("registries.json")[0]).toMatchObject({
        host: expect.any(String),
        username: expect.any(String),
      });
    });

    it("answers no registry credential to a command that is not a stack deploy", async ({
      expect,
    }) => {
      const { w, estateId, secret } = await arrange();
      const estate = await w.rows.estates.getOne({
        where: { id: { eq: estateId } },
      });
      const restart = await alepha
        .inject(EstateCommandService)
        .enqueue(estate, {
          kind: "restart",
          payload: { app: "api", environment: "production" },
        });
      await running(w, restart.id);
      expect((await pull(secret, restart.id, "registries")).status).toBe(404);
    });
  });

  describe("the deploy log", () => {
    it("records Bay's outcome, follows the command to success, and sets the environment's revision", async ({
      expect,
    }) => {
      const { w, estateId, secret, params, env, revision } = await arrange();
      const deployed = (await deploy(w, params)).data;
      await running(w, deployed.commandId);
      const outcome = wire("outcome-stack-deploy.json");
      expect(stackDeployOutcomeSchema.parse(outcome).revision).toBe(2);
      const stored = await pull(secret, deployed.commandId, "outcome", {
        method: "POST",
        body: JSON.stringify(outcome),
      });
      expect(stored.status).toBe(200);
      await alepha.inject(EstateCommandService).ack(estateId, {
        type: "ack",
        id: deployed.commandId,
        status: "done",
      } as never);

      const log = (
        await alepha
          .inject(StackDeployController)
          .listStackDeployments.fetch({ params }, { user: w.user })
      ).data;
      expect(log.items[0]).toMatchObject({ status: "succeeded", revision: 1 });
      expect(JSON.parse(log.items[0].plan ?? "{}").changed).toEqual(["umami"]);
      expect(
        JSON.parse(log.items[0].services ?? "[]").map(
          (s: { service: string }) => s.service,
        ),
      ).toEqual(["db", "umami"]);
      expect((await w.rows.environments.findById(env.id))?.revision).toBe(1);
      expect(
        (await w.rows.revisions.findById(revision.id))?.digests?.db,
      ).toContain("@sha256:");
    });

    it("reads a failed command as a failed deploy, with the machine's reason", async ({
      expect,
    }) => {
      const { w, estateId, params } = await arrange();
      const deployed = (await deploy(w, params)).data;
      await alepha.inject(EstateCommandService).ack(estateId, {
        type: "ack",
        id: deployed.commandId,
        status: "failed",
        reason: "image not found",
      } as never);
      const log = (
        await alepha
          .inject(StackDeployController)
          .listStackDeployments.fetch({ params }, { user: w.user })
      ).data;
      expect(log.items[0]).toMatchObject({
        status: "failed",
        error: "image not found",
      });
    });
  });

  describe("rollback", () => {
    it("deploys an earlier revision's bundle again", async ({ expect }) => {
      const { w, stack, params, revision } = await arrange();
      await upload(
        w,
        stack.id,
        umami.replace("redis:${REDIS_TAG:-7-alpine}", "redis:8-alpine"),
      );
      await deploy(w, params);
      const rolled = (
        await alepha
          .inject(StackDeployController)
          .rollbackStackEnvironment.fetch(
            { params, body: { revision: 1 } },
            { user: w.user },
          )
      ).data;
      const command = await w.rows.commands.getOne({
        where: { id: { eq: rolled.commandId } },
      });
      expect(rolled.revision).toBe(1);
      expect(command.payload.artifact?.id).toBe(revision.id);
    });
  });
});
