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
} from "../src/api/index.ts";
import { packedArtifact } from "../src/testing/index.ts";
import {
  bootStackSpec,
  createInstance,
  stackWorld,
} from "./support/stackWorld.ts";

/**
 * A copy outside any stack, pointed at a Bay estate, deploys through the
 * machine's command queue (#Q2706). Before, the row went to the Worker's
 * Cloudflare run and failed with "names no Cloudflare account".
 */
const wire = (name: string) =>
  JSON.parse(
    readFileSync(
      join(import.meta.dirname, "fixtures/bay/wire-v1", name),
      "utf8",
    ),
  );

describe("an app deploy to a Bay estate", () => {
  let alepha: Alepha;

  beforeEach(async () => {
    alepha = await bootStackSpec();
  });

  afterEach(async () => {
    await alepha.stop();
  });

  const arrange = async () => {
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
      deployAllowed: true,
    });
    await w.rows.grants.create({
      estateId: minted.id,
      projectId: w.project.id,
    } as never);
    const instance = await createInstance(
      alepha,
      w,
      "minpricing",
      "production",
    );
    await alepha.inject(AppController).updateApp.fetch(
      {
        params: {
          projectId: w.project.id,
          app: "minpricing",
          env: "production",
        },
        body: { estateId: minted.id },
      } as never,
      { user: w.user },
    );
    const file = await packedArtifact({
      manifest: { runtimes: [{ runtime: "node" }] },
    });
    await alepha.inject(ArtifactController).pushArtifact.fetch(
      {
        params: { projectId: w.project.id },
        body: { app: "minpricing", tag: "latest", file },
      } as never,
      { user: w.user },
    );
    await alepha.inject(AppSecretController).setAppSecret.fetch(
      {
        params: { projectId: w.project.id, instanceId: instance.id },
        body: { key: "API_KEY", value: "bay-api-key" },
      },
      { user: w.user },
    );
    return {
      w,
      estateId: minted.id,
      secret: minted.secret as string,
      instance,
    };
  };

  const deploy = (a: Awaited<ReturnType<typeof arrange>>) =>
    alepha.inject(DeployService).queue({
      projectId: a.w.project.id,
      instanceId: a.instance.id,
      tag: "latest",
    });

  it("queues a deploy command for the machine, shaped like Bay's wire fixture", async ({
    expect,
  }) => {
    const a = await arrange();
    const row = await deploy(a);
    expect(row.commandId).toBeDefined();
    const command = await a.w.rows.commands.getOne({
      where: { id: { eq: row.commandId ?? "" } },
    });
    expect(command.estateId).toBe(a.estateId);
    const frame = alepha.inject(EstateCommandService).frameOf(command);
    expect(frame).toMatchObject({
      kind: "deploy",
      app: "minpricing",
      environment: "production",
      artifact: { id: row.artifactId, sha256: row.sha256 },
    });
    // The project segment is optional on the wire; every other key is Bay's.
    expect(
      Object.keys(frame)
        .filter((k) => k !== "project")
        .sort(),
    ).toEqual(Object.keys(wire("command-deploy.json")).sort());
    expect(frame).not.toHaveProperty("stack");
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
    const list = () =>
      alepha.inject(DeployService).list(a.w.project.id, a.instance.id);
    expect((await list())[0].status).toBe("running");
    await queue.ack(a.estateId, {
      type: "ack",
      id: row.commandId,
      status: "done",
    } as never);
    const [after] = await list();
    expect(after).toMatchObject({ status: "succeeded" });
    expect(after.error).toBeUndefined();
  });

  it("hands the machine that copy's own variables", async ({ expect }) => {
    const a = await arrange();
    const row = await deploy(a);
    await a.w.rows.commands.updateById(row.commandId ?? "", {
      status: "running",
    });
    const base = alepha.inject(NodeHttpServerProvider).hostname;
    const res = await fetch(
      `${base}/estates/commands/${row.commandId}/secrets`,
      { headers: { authorization: `Bearer ${a.secret}` } },
    );
    expect(await res.json()).toMatchObject({ API_KEY: "bay-api-key" });
  });

  it("goes through the Deploy tab's endpoint the same way", async ({
    expect,
  }) => {
    const a = await arrange();
    const started = (
      await alepha.inject(DeployController).startDeploy.fetch(
        {
          params: { projectId: a.w.project.id, instanceId: a.instance.id },
          body: { tag: "latest" },
        } as never,
        { user: a.w.user },
      )
    ).data;
    expect(started.status).toBe("queued");
    const commands = await a.w.rows.commands.findMany({});
    expect(commands.map((c) => c.kind)).toEqual(["deploy"]);
  });
});
