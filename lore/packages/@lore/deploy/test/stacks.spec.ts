import type { Alepha } from "alepha";
import { FileService } from "alepha/api/files";
import { afterEach, beforeEach, describe, it } from "vitest";

import { StackController, StackService } from "../src/api/index.ts";
import {
  bootStackSpec,
  createEnvironment,
  createInstance,
  createStack,
  lentBayEstate,
  newUser,
  stackWorld,
} from "./support/stackWorld.ts";

/**
 * Stacks, their environments, routes, revisions and member apps (#Q2690).
 *
 * The refusals are the feature: an estate the project was never lent, an app
 * of another project or of another env name, an app already in another
 * environment.
 */
describe("stacks", () => {
  let alepha: Alepha;

  beforeEach(async () => {
    alepha = await bootStackSpec();
  });

  afterEach(async () => {
    await alepha.stop();
  });

  describe("a stack and its environments", () => {
    it("is named after the project slug by default and lists its environments", async ({
      expect,
    }) => {
      const w = await stackWorld(alepha);
      const estate = await lentBayEstate(w);
      const stack = await createStack(alepha, w, { estateId: estate.id });
      expect(stack.name).toBe(w.project.slug);
      expect(stack.estateId).toBe(estate.id);

      await createEnvironment(alepha, w, stack.id, { env: "production" });
      await createEnvironment(alepha, w, stack.id, {
        env: "Staging",
        baseDomain: "Staging.Example.com",
      });

      const listed = (
        await alepha
          .inject(StackController)
          .listStacks.fetch(
            { params: { projectId: w.project.id } },
            { user: w.user },
          )
      ).data;
      expect(listed.items).toHaveLength(1);
      expect(listed.items[0].environments.map((e) => e.env)).toEqual([
        "production",
        "staging",
      ]);
      expect(listed.items[0].environments[1].baseDomain).toBe(
        "staging.example.com",
      );
    });

    it("resolves an environment's estate from its own override, else the stack's default", async ({
      expect,
    }) => {
      const w = await stackWorld(alepha);
      const main = await lentBayEstate(w);
      const cheap = await lentBayEstate(w);
      const stack = await createStack(alepha, w, {
        name: "umami",
        estateId: main.id,
      });
      const production = await createEnvironment(alepha, w, stack.id, {
        env: "production",
      });
      const staging = await createEnvironment(alepha, w, stack.id, {
        env: "staging",
        estateId: cheap.id,
      });

      const service = alepha.inject(StackService);
      const row = await service.get(w.project.id, stack.id);
      expect(
        service.estateOf(row, await service.getEnvironment(row, production.id)),
      ).toBe(main.id);
      expect(
        service.estateOf(row, await service.getEnvironment(row, staging.id)),
      ).toBe(cheap.id);

      await alepha.inject(StackController).updateStackEnvironment.fetch(
        {
          params: {
            projectId: w.project.id,
            stackId: stack.id,
            environmentId: staging.id,
          },
          body: { estateId: null },
        },
        { user: w.user },
      );
      expect(
        service.estateOf(row, await service.getEnvironment(row, staging.id)),
      ).toBe(main.id);
    });

    it("refuses an estate the project was never lent", async ({ expect }) => {
      const w = await stackWorld(alepha);
      const foreign = await lentBayEstate(w, { lend: false });
      await expect(
        createStack(alepha, w, { estateId: foreign.id }),
      ).rejects.toThrow("no such estate");
      const stack = await createStack(alepha, w, { name: "app" });
      await expect(
        createEnvironment(alepha, w, stack.id, {
          env: "production",
          estateId: foreign.id,
        }),
      ).rejects.toThrow("no such estate");
    });

    it("refuses a second stack or environment of the same name", async ({
      expect,
    }) => {
      const w = await stackWorld(alepha);
      const stack = await createStack(alepha, w, { name: "umami" });
      await expect(createStack(alepha, w, { name: "Umami" })).rejects.toThrow(
        "already has a stack",
      );
      await createEnvironment(alepha, w, stack.id, { env: "production" });
      await expect(
        createEnvironment(alepha, w, stack.id, { env: "production" }),
      ).rejects.toThrow("already has an environment");
    });
  });

  describe("environment routes", () => {
    it("adds and removes full-domain routes, normalised and unique per environment", async ({
      expect,
    }) => {
      const w = await stackWorld(alepha);
      const stack = await createStack(alepha, w, { name: "umami" });
      const env = await createEnvironment(alepha, w, stack.id, {
        env: "production",
      });
      const params = {
        projectId: w.project.id,
        stackId: stack.id,
        environmentId: env.id,
      };
      const controller = alepha.inject(StackController);

      const added = (
        await controller.addStackRoute.fetch(
          { params, body: { service: "umami", domain: "Analytics.Bob.dev" } },
          { user: w.user },
        )
      ).data;
      expect(added.routes).toEqual([
        { service: "umami", domain: "analytics.bob.dev" },
      ]);
      await expect(
        controller.addStackRoute.fetch(
          { params, body: { service: "umami", domain: "analytics.bob.dev" } },
          { user: w.user },
        ),
      ).rejects.toThrow("already routed");
      await expect(
        controller.addStackRoute.fetch(
          { params, body: { service: "umami", domain: "https://x/y" } },
          { user: w.user },
        ),
      ).rejects.toThrow("not a domain");

      const removed = (
        await controller.removeStackRoute.fetch(
          { params, query: { domain: "analytics.bob.dev" } },
          { user: w.user },
        )
      ).data;
      expect(removed.routes).toEqual([]);
    });
  });

  describe("member apps", () => {
    it("takes an app of this project with the environment's own env name", async ({
      expect,
    }) => {
      const w = await stackWorld(alepha);
      const stack = await createStack(alepha, w, { name: "mcs" });
      const staging = await createEnvironment(alepha, w, stack.id, {
        env: "staging",
      });
      const api = await createInstance(alepha, w, "mcs-api", "staging");
      const params = {
        projectId: w.project.id,
        stackId: stack.id,
        environmentId: staging.id,
      };

      const joined = (
        await alepha
          .inject(StackController)
          .attachStackMember.fetch(
            { params, body: { instanceId: api.id } },
            { user: w.user },
          )
      ).data;
      expect(joined.members).toEqual([
        { id: api.id, app: "mcs-api", env: "staging" },
      ]);
      expect(
        (await w.rows.instances.findById(api.id))?.stackEnvironmentId,
      ).toBe(staging.id);
    });

    it("refuses an app of another env name, of another project, or already in another environment", async ({
      expect,
    }) => {
      const w = await stackWorld(alepha);
      const stack = await createStack(alepha, w, { name: "mcs" });
      const production = await createEnvironment(alepha, w, stack.id, {
        env: "production",
      });
      const other = await createStack(alepha, w, { name: "other" });
      const otherProd = await createEnvironment(alepha, w, other.id, {
        env: "production",
      });
      const staging = await createInstance(alepha, w, "mcs-api", "staging");
      const prod = await createInstance(alepha, w, "mcs-api", "production");
      const controller = alepha.inject(StackController);
      const attach = (
        environmentId: string,
        stackId: string,
        instanceId: string,
      ) =>
        controller.attachStackMember.fetch(
          {
            params: { projectId: w.project.id, stackId, environmentId },
            body: { instanceId },
          },
          { user: w.user },
        );

      await expect(attach(production.id, stack.id, staging.id)).rejects.toThrow(
        "its own env name",
      );

      const elsewhere = await stackWorld(alepha);
      const foreign = await createInstance(
        alepha,
        elsewhere,
        "mcs-api",
        "production",
      );
      await expect(attach(production.id, stack.id, foreign.id)).rejects.toThrow(
        "no such app instance",
      );

      await attach(production.id, stack.id, prod.id);
      await expect(attach(otherProd.id, other.id, prod.id)).rejects.toThrow(
        "already a member",
      );
    });

    it("leaves members as ordinary copies when their stack is deleted", async ({
      expect,
    }) => {
      const w = await stackWorld(alepha);
      const stack = await createStack(alepha, w, { name: "mcs" });
      const production = await createEnvironment(alepha, w, stack.id, {
        env: "production",
      });
      const api = await createInstance(alepha, w, "mcs-api", "production");
      await alepha.inject(StackController).attachStackMember.fetch(
        {
          params: {
            projectId: w.project.id,
            stackId: stack.id,
            environmentId: production.id,
          },
          body: { instanceId: api.id },
        },
        { user: w.user },
      );
      await alepha
        .inject(StackController)
        .deleteStack.fetch(
          { params: { projectId: w.project.id, stackId: stack.id } },
          { user: w.user },
        );

      const survivor = await w.rows.instances.findById(api.id);
      expect(survivor).toBeDefined();
      expect(survivor?.stackEnvironmentId).toBeUndefined();
      expect(
        await w.rows.environments.findMany({
          where: { stackId: { eq: stack.id } },
        }),
      ).toEqual([]);
    });
  });

  describe("revisions", () => {
    it("stores the bundle in object storage and numbers revisions per stack", async ({
      expect,
    }) => {
      const w = await stackWorld(alepha);
      const stack = await createStack(alepha, w, { name: "umami" });
      const service = alepha.inject(StackService);
      const row = await service.get(w.project.id, stack.id);
      const bundle = (text: string) =>
        new File([text], "bundle.tar.gz", { type: "application/gzip" });

      const first = await service.addRevision({
        stack: row,
        file: bundle("one"),
        sha256: "a".repeat(64),
        size: 3,
        model: "{}",
        compose: "services: {}",
      });
      const second = await service.addRevision({
        stack: row,
        file: bundle("two"),
        sha256: "b".repeat(64),
        size: 3,
        model: "{}",
        compose: "services: {}",
      });
      expect([first.number, second.number]).toEqual([1, 2]);
      const stored = await alepha.inject(FileService).streamFile(first.fileId);
      expect(stored).toBeDefined();

      await service.delete(row);
      await expect(
        alepha.inject(FileService).streamFile(first.fileId),
      ).rejects.toThrow();
    });
  });

  describe("who may do what", () => {
    it("refuses a stranger's write, and every write while deploy is off, but still reads", async ({
      expect,
    }) => {
      const w = await stackWorld(alepha);
      const stranger = await newUser(alepha);
      await expect(
        alepha
          .inject(StackController)
          .createStack.fetch(
            { params: { projectId: w.project.id }, body: { name: "x" } },
            { user: stranger },
          ),
      ).rejects.toThrow();

      const off = await stackWorld(alepha, { deploy: false });
      await expect(createStack(alepha, off, { name: "x" })).rejects.toThrow();
      const listed = await alepha
        .inject(StackController)
        .listStacks.fetch(
          { params: { projectId: off.project.id } },
          { user: off.user },
        );
      expect(listed.data.items).toEqual([]);
    });
  });
});
