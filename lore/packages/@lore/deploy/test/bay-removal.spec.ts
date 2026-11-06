import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { Alepha } from "alepha";
import { BadRequestError, ForbiddenError, NotFoundError } from "alepha/server";
import { afterEach, beforeEach, describe, it } from "vitest";

import {
  AppController,
  EstateCommandService,
  EstateInventoryService,
  StackDeployController,
} from "../src/api/index.ts";
import {
  bootStackSpec,
  createEnvironment,
  createInstance,
  createStack,
  lentBayEstate,
  type StackWorld,
  stackWorld,
} from "./support/stackWorld.ts";

/**
 * Undeploying from a Bay (#Q3153, folio #F1455 of the Alepha project).
 *
 * `remove` and `stack-remove` are aimed at the name the copy was deployed
 * under, held to the estate's deploy switch, and carry no purge: the frames
 * Lore queues have exactly the shape of Bay's own fixtures, which have no
 * field for one. A copy still running on its Bay cannot be forgotten without
 * `forget`, or it would keep serving with nothing in Lore able to remove it.
 */
describe("Undeploying from a Bay", () => {
  let alepha: Alepha;

  beforeEach(async () => {
    alepha = await bootStackSpec();
  });

  afterEach(async () => {
    await alepha.stop();
  });

  const fixture = (dir: string, name: string) =>
    JSON.parse(
      readFileSync(
        join(import.meta.dirname, "fixtures/bay", dir, name),
        "utf8",
      ),
    ) as Record<string, unknown>;

  /** A copy pointed at a lent Bay estate and deployed there once. */
  const deployed = async (options: { deployAllowed?: boolean } = {}) => {
    const w = await stackWorld(alepha);
    const estate = await lentBayEstate(w, options);
    const instance = await createInstance(alepha, w, "shop", "staging");
    const machineApp = `p${w.project.id}-shop`;
    await w.rows.instances.updateById(instance.id, {
      estateId: estate.id,
      resourceName: `${machineApp}-staging`,
      resourceEstateId: estate.id,
    });
    return { w, estate, instance, machineApp };
  };

  const params = (w: StackWorld) => ({
    projectId: w.project.id,
    app: "shop",
    env: "staging",
  });

  const destroy = (w: StackWorld, confirm = "shop/staging") =>
    alepha
      .inject(AppController)
      .destroyAppResources({ params: params(w), body: { confirm } }, {
        user: w.user,
      } as never);

  const report = async (estate: { id: string }, apps: string[]) => {
    await alepha.inject(EstateInventoryService).record(
      estate as never,
      {
        type: "inventory",
        at: new Date().toISOString(),
        host: {},
        apps: apps.map((app) => ({
          app,
          env: "staging",
          running: true,
          backups: false,
          problems: [],
        })),
      } as never,
    );
  };

  describe("a copy", () => {
    it("queues a remove under the machine's name, shaped like Bay's fixture", async ({
      expect,
    }) => {
      const { w, machineApp } = await deployed();

      const result = await destroy(w);

      expect(result.removed).toEqual([]);
      expect(result.kept).toEqual(["database", "uploads", ".env"]);
      const command = result.removal?.command;
      expect(command?.kind).toBe("remove");
      expect(command?.payload).toEqual({
        app: machineApp,
        environment: "staging",
      });
      const frame = alepha
        .inject(EstateCommandService)
        .frameOf(command as never);
      const pinned = fixture("wire-v1", "command-remove.json");
      expect(Object.keys(frame).sort()).toEqual(Object.keys(pinned).sort());

      const read = await alepha
        .inject(AppController)
        .getAppRemoval(
          { params: { ...params(w), commandId: command?.id as string } },
          { user: w.user } as never,
        );
      expect(read.id).toBe(command?.id);
    });

    it("refuses a confirmation that does not name the copy", async ({
      expect,
    }) => {
      const { w } = await deployed();
      await expect(destroy(w, "shop/production")).rejects.toThrow(
        BadRequestError,
      );
    });

    it("is held to the estate's deploy switch", async ({ expect }) => {
      const { w } = await deployed({ deployAllowed: false });
      await expect(destroy(w)).rejects.toThrow(ForbiddenError);
    });

    it("refuses a copy that never deployed to its Bay", async ({ expect }) => {
      const { w, instance } = await deployed();
      await w.rows.instances.updateById(instance.id, {
        resourceName: null as never,
      });
      await expect(destroy(w)).rejects.toThrow(/not been deployed/);
    });

    it("refuses a stack member: it goes with its stack environment", async ({
      expect,
    }) => {
      const { w, estate, instance } = await deployed();
      const stack = await createStack(alepha, w, { estateId: estate.id });
      const environment = await createEnvironment(alepha, w, stack.id, {
        env: "staging",
      });
      await w.rows.instances.updateById(instance.id, {
        stackEnvironmentId: environment.id,
      });
      await expect(destroy(w)).rejects.toThrow(/stack/);
    });

    it("does not let another project read its removal", async ({ expect }) => {
      const { w } = await deployed();
      const result = await destroy(w);
      const other = await deployed();
      await expect(
        alepha.inject(AppController).getAppRemoval(
          {
            params: {
              ...params(other.w),
              commandId: result.removal?.command.id as string,
            },
          },
          { user: other.w.user } as never,
        ),
      ).rejects.toThrow(NotFoundError);
    });
  });

  describe("forgetting a copy", () => {
    const remove = (w: StackWorld, forget?: boolean) =>
      alepha
        .inject(AppController)
        .deleteApp({ params: params(w), body: forget ? { forget } : {} }, {
          user: w.user,
        } as never);

    it("is refused while the machine still reports it, and pointed at destroy", async ({
      expect,
    }) => {
      const { w, estate, machineApp } = await deployed();
      await report(estate, [machineApp]);
      await expect(remove(w)).rejects.toThrow(/lore apps destroy/);
    });

    it("is refused before the machine has reported anything", async ({
      expect,
    }) => {
      const { w } = await deployed();
      await expect(remove(w)).rejects.toThrow(/still runs on its Bay/);
    });

    it("goes through once the machine no longer reports it", async ({
      expect,
    }) => {
      const { w, estate } = await deployed();
      await report(estate, ["someone-else"]);
      expect((await remove(w)).ok).toBe(true);
    });

    it("goes through with forget, for a machine that is gone", async ({
      expect,
    }) => {
      const { w, estate, machineApp } = await deployed();
      await report(estate, [machineApp]);
      expect((await remove(w, true)).ok).toBe(true);
    });
  });

  describe("a stack environment", () => {
    const arrange = async (options: { deployAllowed?: boolean } = {}) => {
      const w = await stackWorld(alepha);
      const estate = await lentBayEstate(w, options);
      const stack = await createStack(alepha, w, {
        name: "umami",
        estateId: estate.id,
      });
      const environment = await createEnvironment(alepha, w, stack.id, {
        env: "production",
      });
      const target = {
        projectId: w.project.id,
        stackId: stack.id,
        environmentId: environment.id,
      };
      return { w, estate, stack, environment, target };
    };

    const removeEnv = (w: StackWorld, target: Record<string, unknown>) =>
      alepha
        .inject(StackDeployController)
        .removeStackEnvironment({ params: target as never }, {
          user: w.user,
        } as never);

    it("never deployed, queues nothing", async ({ expect }) => {
      const { w, target } = await arrange();
      expect(await removeEnv(w, target)).toEqual({});
    });

    it("deployed, queues a stack-remove shaped like Bay's fixture", async ({
      expect,
    }) => {
      const { w, environment, target, estate } = await arrange();
      await w.rows.environments.updateById(environment.id, { revision: 1 });

      const queued = await removeEnv(w, target);

      expect(queued.estate).toBe(estate.slug);
      expect(queued.command?.kind).toBe("stack-remove");
      expect(queued.command?.payload).toEqual({
        app: "",
        environment: "production",
        stack: "umami",
      });
      const frame = alepha
        .inject(EstateCommandService)
        .frameOf(queued.command as never);
      const pinned = fixture("wire-v2", "command-stack-remove.json");
      expect(Object.keys(frame).sort()).toEqual(Object.keys(pinned).sort());

      const read = await alepha.inject(StackDeployController).getStackRemoval(
        {
          params: { ...target, commandId: queued.command?.id as string },
        } as never,
        { user: w.user } as never,
      );
      expect(read.id).toBe(queued.command?.id);
    });

    it("is held to the estate's deploy switch", async ({ expect }) => {
      const { w, environment, target } = await arrange({
        deployAllowed: false,
      });
      await w.rows.environments.updateById(environment.id, { revision: 1 });
      await expect(removeEnv(w, target)).rejects.toThrow(ForbiddenError);
    });
  });
});
