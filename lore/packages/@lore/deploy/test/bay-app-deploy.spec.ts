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
} from "../src/api/index.ts";
import { createTestEstate } from "../src/testing/estates.ts";
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
    const minted = await createTestEstate(
      alepha,
      w.user,
      { slug: `bay-${crypto.randomUUID().slice(0, 6)}` },
      {
        projectId: w.project.id,
      },
    );
    await w.rows.estates.updateById(minted.id, {
      deployAllowed: true,
    });
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
      },
      { user: w.user },
    );
    const file = await packedArtifact({
      manifest: { runtimes: [{ runtime: "node" }] },
    });
    await alepha.inject(ArtifactController).pushArtifact.fetch(
      {
        params: { projectId: w.project.id },
        body: { app: "minpricing", tag: "latest", file },
      },
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
    // ⚠️ The segment the copy is named with has to reach the machine: without
    // it Bay runs `<app>/<env>` and Lore asks for `<project>-<app>` (#Q3285).
    expect(a.w.project.slug).toBeTruthy();
    expect(command.payload.project).toBe(a.w.project.slug);
    expect(frame.project).toBe(a.w.project.slug);
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

  it("records where the machine says the copy answers, on the row and on an address-less copy (#Q3155)", async ({
    expect,
  }) => {
    const a = await arrange();
    const row = await deploy(a);
    await alepha.inject(DeployService).run(row);
    await alepha.inject(EstateCommandService).ack(a.estateId, {
      type: "ack",
      id: row.commandId,
      status: "done",
      url: "https://minpricing-production.bay.example.com/",
    } as never);

    const [after] = await alepha
      .inject(DeployService)
      .list(a.w.project.id, a.instance.id);
    expect(after.url).toBe("https://minpricing-production.bay.example.com");
    const copy = await a.w.rows.instances.findById(a.instance.id);
    expect(copy?.url).toBe("https://minpricing-production.bay.example.com");
  });

  it("says on the deploy's log where the APP_SECRET came from, and the machine's warning", async ({
    expect,
  }) => {
    // A recovery that restored the data on a new key locked every MFA user
    // out while every check was green: the deploy now says so where it is read.
    const a = await arrange();
    const row = await deploy(a);
    await alepha.inject(DeployService).run(row);
    await alepha.inject(EstateCommandService).ack(a.estateId, {
      type: "ack",
      id: row.commandId,
      status: "done",
      appSecretSource: "minted",
      warning:
        "demo/production runs on a NEW APP_SECRET over data restored from a backup that carried none",
    } as never);

    const [after] = await alepha
      .inject(DeployService)
      .list(a.w.project.id, a.instance.id);
    const lines = after.log.map((line) => line.text);
    expect(lines).toContain("APP_SECRET: minted by the machine, a new key");
    expect(lines).toContain(
      "Warning: demo/production runs on a NEW APP_SECRET over data restored from a backup that carried none",
    );
  });

  it("keeps a copy's own address, and drops an address that is not http(s)", async ({
    expect,
  }) => {
    const a = await arrange();
    await a.w.rows.instances.updateById(a.instance.id, {
      url: "https://minpricing.example.com",
    });
    const row = await deploy(a);
    await alepha.inject(DeployService).run(row);
    await alepha.inject(EstateCommandService).ack(a.estateId, {
      type: "ack",
      id: row.commandId,
      status: "done",
      url: "javascript:alert(1)",
    } as never);

    const [after] = await alepha
      .inject(DeployService)
      .list(a.w.project.id, a.instance.id);
    expect(after.status).toBe("succeeded");
    expect(after.url).toBeUndefined();
    const copy = await a.w.rows.instances.findById(a.instance.id);
    expect(copy?.url).toBe("https://minpricing.example.com");
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
        },
        { user: a.w.user },
      )
    ).data;
    expect(started.status).toBe("queued");
    const commands = await a.w.rows.commands.findMany({});
    expect(commands.map((c) => c.kind)).toEqual(["deploy"]);
  });
});
