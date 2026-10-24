import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { Alepha } from "alepha";
import { NodeHttpServerProvider } from "alepha/server";
import { afterEach, beforeEach, describe, it } from "vitest";

import {
  AppController,
  AppSecretController,
  ArtifactController,
  DeployController,
  DeployService,
  EstateCommandService,
  EstateController,
  StackController,
  StackDeployController,
} from "../src/api/index.ts";
import { packedArtifact } from "../src/testing/index.ts";
import {
  bootStackSpec,
  createEnvironment,
  createInstance,
  createStack,
  stackWorld,
} from "./support/stackWorld.ts";

/**
 * An app instance that is a member of a stack environment deploys through
 * it (#Q2695): the estate is the environment's, only its own service is
 * redeployed (Bay's `deploy` naming the stack and the service), and the
 * Deploy tab's row follows the machine's acks.
 */
const wire = (name: string) =>
  JSON.parse(
    readFileSync(
      join(import.meta.dirname, "fixtures/bay/wire-v2", name),
      "utf8",
    ),
  );

const compose = [
  "services:",
  "  cache:",
  "    image: redis:7-alpine",
  "  api:",
  "    depends_on: [cache]",
  "    x-lore:",
  "      app: mcs-api",
  '      routes: ["@"]',
  "",
].join("\n");

describe("an app deploy inside a stack", () => {
  let alepha: Alepha;

  beforeEach(async () => {
    alepha = await bootStackSpec();
  });

  afterEach(async () => {
    await alepha.stop();
  });

  const arrange = async (options: { applied?: boolean } = {}) => {
    const w = await stackWorld(alepha);
    const minted = (
      await alepha
        .inject(EstateController)
        .createEstate.fetch(
          { body: { slug: `bay-${crypto.randomUUID().slice(0, 6)}` } },
          { user: w.user },
        )
    ).data;
    await w.rows.estates.updateById(minted.id, { deployAllowed: true });
    await w.rows.grants.create({
      estateId: minted.id,
      projectId: w.project.id,
    } as never);
    const stack = await createStack(alepha, w, {
      name: "mcs",
      estateId: minted.id,
    });
    const env = await createEnvironment(alepha, w, stack.id, {
      env: "staging",
    });
    const instance = await createInstance(alepha, w, "mcs-api", "staging");
    await alepha
      .inject(StackController)
      .attachStackMember.fetch(
        {
          params: {
            projectId: w.project.id,
            stackId: stack.id,
            environmentId: env.id,
          },
          body: { instanceId: instance.id },
        },
        { user: w.user },
      );
    await alepha
      .inject(StackController)
      .uploadStackRevision.fetch(
        {
          params: { projectId: w.project.id, stackId: stack.id },
          body: { file: new File([compose], "compose.yml") },
        },
        { user: w.user },
      );
    if (options.applied ?? true) {
      // As if the stack had been deployed and Bay had acked it.
      await w.rows.environments.updateById(env.id, { revision: 1 });
    }
    const file = await packedArtifact({
      manifest: { runtimes: [{ runtime: "node" }] },
    });
    await alepha
      .inject(ArtifactController)
      .pushArtifact.fetch(
        {
          params: { projectId: w.project.id },
          body: { app: "mcs-api", tag: "1.0.0", file },
        } as never,
        { user: w.user },
      );
    await alepha
      .inject(AppSecretController)
      .setAppSecret.fetch(
        {
          params: { projectId: w.project.id, instanceId: instance.id },
          body: { key: "API_KEY", value: "member-api-key" },
        },
        { user: w.user },
      );
    return {
      w,
      estateId: minted.id,
      secret: minted.secret as string,
      stack,
      env,
      instance,
    };
  };

  const deploy = (a: Awaited<ReturnType<typeof arrange>>) =>
    alepha
      .inject(DeployService)
      .queue({
        projectId: a.w.project.id,
        instanceId: a.instance.id,
        tag: "1.0.0",
      });

  it("queues a Bay deploy naming the stack and the app service, with no estate on the copy", async ({
    expect,
  }) => {
    const a = await arrange();
    expect(
      (await a.w.rows.instances.findById(a.instance.id))?.estateId,
    ).toBeUndefined();
    const row = await deploy(a);
    const command = await a.w.rows.commands.getOne({
      where: { id: { eq: row.commandId ?? "" } },
    });
    const frame = alepha.inject(EstateCommandService).frameOf(command);
    expect(frame).toMatchObject({
      kind: "deploy",
      app: "mcs-api",
      environment: "staging",
      stack: "mcs",
      service: "api",
    });
    expect(Object.keys(frame).sort()).toEqual(
      Object.keys(wire("command-member-deploy.json")).sort(),
    );
    expect(frame).not.toHaveProperty("instanceId");
    expect(command.estateId).toBe(a.estateId);
  });

  it("refuses before the stack has ever been deployed, naming why", async ({
    expect,
  }) => {
    const a = await arrange({ applied: false });
    await expect(deploy(a)).rejects.toThrow("has never been deployed");
  });

  it("follows the machine's acks to succeeded, and the run job leaves the row alone", async ({
    expect,
  }) => {
    const a = await arrange();
    const row = await deploy(a);
    expect(await alepha.inject(DeployService).run(row)).toBe("done");
    const queue = alepha.inject(EstateCommandService);
    await queue.ack(a.estateId, {
      type: "ack",
      id: row.commandId,
      status: "running",
      step: "deploying",
    } as never);
    expect(
      (
        await alepha.inject(DeployService).list(a.w.project.id, a.instance.id)
      )[0].status,
    ).toBe("running");
    await queue.ack(a.estateId, {
      type: "ack",
      id: row.commandId,
      status: "done",
    } as never);
    const [after] = await alepha
      .inject(DeployService)
      .list(a.w.project.id, a.instance.id);
    expect(after).toMatchObject({ status: "succeeded" });
    expect(after.finishedAt).toBeDefined();
  });

  it("hands the machine that copy's own variables for its deploy", async ({
    expect,
  }) => {
    const a = await arrange();
    const row = await deploy(a);
    await a.w.rows.commands.updateById(row.commandId ?? "", {
      status: "running",
    });
    const base = alepha.inject(NodeHttpServerProvider).hostname;
    const res = await fetch(
      `${base}/estates/commands/${row.commandId}/secrets`,
      {
        headers: { authorization: `Bearer ${a.secret}` },
      },
    );
    expect(await res.json()).toEqual({ API_KEY: "member-api-key" });
  });

  it("names the stack environment on the copy, which the Settings tab reads", async ({
    expect,
  }) => {
    const a = await arrange();
    const resource = (
      await alepha
        .inject(AppController)
        .getApp.fetch(
          {
            params: {
              projectId: a.w.project.id,
              app: "mcs-api",
              env: "staging",
            },
          } as never,
          { user: a.w.user },
        )
    ).data as {
      stack?: { name: string; env: string };
      stackEnvironmentId?: string;
    };
    expect(resource.stack).toMatchObject({ name: "mcs", env: "staging" });
    expect(resource.stackEnvironmentId).toBe(a.env.id);
  });

  it("goes through the Deploy tab's endpoint the same way", async ({
    expect,
  }) => {
    const a = await arrange();
    const started = (
      await alepha
        .inject(DeployController)
        .startDeploy.fetch(
          {
            params: { projectId: a.w.project.id, instanceId: a.instance.id },
            body: { tag: "1.0.0" },
          } as never,
          { user: a.w.user },
        )
    ).data;
    expect(started.status).toBe("queued");
    const commands = await a.w.rows.commands.findMany({});
    expect(commands.map((c) => c.kind)).toEqual(["deploy"]);
    expect(StackDeployController).toBeDefined();
  });
});
