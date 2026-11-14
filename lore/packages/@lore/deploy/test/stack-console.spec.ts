import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { Alepha } from "alepha";
import { afterEach, beforeEach, describe, it } from "vitest";

import {
  HostInventoryService,
  StackController,
  StackDeployController,
} from "../src/api/index.ts";
import { hostInventoryFrameSchema } from "../src/api/schemas/hostInventoryFrameSchema.ts";
import { createTestHost } from "../src/testing/hosts.ts";
import {
  bootStackSpec,
  createEnvironment,
  createStack,
  newUser,
  stackWorld,
} from "./support/stackWorld.ts";

/**
 * What the stack console reads beyond deploys (#Q2696): each service joined
 * with what the machine last reported, volume coverage, and the per-service
 * verbs, which Bay keys on `<stack>.<service>`.
 */
const inventoryFixture = () =>
  JSON.parse(
    readFileSync(
      join(import.meta.dirname, "fixtures/bay/wire-v2/inventory-stacks.json"),
      "utf8",
    ),
  );

describe("the stack console", () => {
  let alepha: Alepha;

  beforeEach(async () => {
    alepha = await bootStackSpec();
  });

  afterEach(async () => {
    await alepha.stop();
  });

  const arrange = async () => {
    const w = await stackWorld(alepha);
    const minted = await createTestHost(
      alepha,
      w.user,
      { slug: `bay-${crypto.randomUUID().slice(0, 6)}` },
      {
        projectId: w.project.id,
      },
    );
    const stack = await createStack(alepha, w, {
      name: "umami",
      hostId: minted.id,
    });
    const env = await createEnvironment(alepha, w, stack.id, {
      env: "production",
    });
    await alepha.inject(StackController).uploadStackRevision.fetch(
      {
        params: { projectId: w.project.id, stackId: stack.id },
        body: {
          file: new File(
            [
              readFileSync(
                join(
                  import.meta.dirname,
                  "fixtures/bay/compose/accepted/umami/compose.yml",
                ),
              ),
            ],
            "compose.yml",
          ),
        },
      },
      { user: w.user },
    );
    await w.rows.environments.updateById(env.id, { revision: 1 });
    const params = {
      projectId: w.project.id,
      stackId: stack.id,
      environmentId: env.id,
    };
    return { w, hostId: minted.id, stack, env, params };
  };

  it("keeps Bay's stacks and member fields when an inventory is read", ({
    expect,
  }) => {
    const frame = hostInventoryFrameSchema.parse(inventoryFixture());
    expect(frame.stacks?.[0]).toMatchObject({
      stack: "umami",
      env: "production",
      notBackedUp: ["umami-db-data"],
    });
    expect(frame.apps[0]).toMatchObject({
      stack: "umami",
      service: "umami",
      serviceKind: "service",
    });
  });

  it("joins each service with what the machine reported, and says which volumes no backup covers", async ({
    expect,
  }) => {
    const { w, hostId, params } = await arrange();
    const before = (
      await alepha
        .inject(StackDeployController)
        .listStackServices.fetch({ params }, { user: w.user })
    ).data;
    expect(before.services.map((s) => s.name)).toEqual(["db", "umami"]);
    expect(before.volumes).toEqual([{ name: "umami-db-data" }]);

    const host = await w.rows.hosts.getOne({
      where: { id: { eq: hostId } },
    });
    await alepha
      .inject(HostInventoryService)
      .record(host, hostInventoryFrameSchema.parse(inventoryFixture()));
    const after = (
      await alepha
        .inject(StackDeployController)
        .listStackServices.fetch({ params }, { user: w.user })
    ).data;
    expect(after.services.find((s) => s.name === "umami")).toMatchObject({
      running: true,
      state: "active",
      domains: ["analytics.bob.dev"],
    });
    expect(after.volumes).toEqual([{ name: "umami-db-data", backedUp: false }]);
    expect(after.reportedAt).toBeDefined();
  });

  it("restarts, stops and starts one service by its member name, and refuses one the revision lacks", async ({
    expect,
  }) => {
    const { w, params } = await arrange();
    const controller = alepha.inject(StackDeployController);
    for (const verb of ["restart", "stop", "start"] as const) {
      const { command } = (
        await controller.stackServiceAction.fetch(
          { params: { ...params, service: "db", verb } },
          { user: w.user },
        )
      ).data;
      const row = await w.rows.commands.getOne({
        where: { id: { eq: command } },
      });
      expect([row.kind, row.payload.app, row.payload.environment]).toEqual([
        verb,
        "umami.db",
        "production",
      ]);
    }
    await expect(
      controller.stackServiceAction.fetch(
        { params: { ...params, service: "nope", verb: "restart" } },
        { user: w.user },
      ),
    ).rejects.toThrow("has no service nope");
    const stranger = await newUser(alepha);
    await expect(
      controller.stackServiceAction.fetch(
        { params: { ...params, service: "db", verb: "restart" } },
        { user: stranger },
      ),
    ).rejects.toThrow();
  });
});
