import type { Alepha } from "alepha";
import { FileService } from "alepha/api/files";
import { afterEach, beforeEach, describe, it } from "vitest";

import {
  HostController,
  StackController,
  StackService,
} from "../src/api/index.ts";
import {
  bootStackSpec,
  createEnvironment,
  createInstance,
  createStack,
  lentBayHost,
  newUser,
  stackWorld,
} from "./support/stackWorld.ts";

/**
 * Stacks, their environments, routes, revisions and member apps (#Q2690).
 *
 * The refusals are the feature: a host the project was never lent, an app
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
      const host = await lentBayHost(w);
      const stack = await createStack(alepha, w, { hostId: host.id });
      expect(stack.name).toBe(w.project.slug);
      expect(stack.hostId).toBe(host.id);

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

    it("resolves an environment's host from its own override, else the stack's default", async ({
      expect,
    }) => {
      const w = await stackWorld(alepha);
      const main = await lentBayHost(w);
      const cheap = await lentBayHost(w);
      const stack = await createStack(alepha, w, {
        name: "umami",
        hostId: main.id,
      });
      const production = await createEnvironment(alepha, w, stack.id, {
        env: "production",
      });
      const staging = await createEnvironment(alepha, w, stack.id, {
        env: "staging",
        hostId: cheap.id,
      });

      const service = alepha.inject(StackService);
      const row = await service.get(w.project.id, stack.id);
      expect(
        service.hostOf(row, await service.getEnvironment(row, production.id)),
      ).toBe(main.id);
      expect(
        service.hostOf(row, await service.getEnvironment(row, staging.id)),
      ).toBe(cheap.id);

      await alepha.inject(StackController).updateStackEnvironment.fetch(
        {
          params: {
            projectId: w.project.id,
            stackId: stack.id,
            environmentId: staging.id,
          },
          body: { hostId: null },
        },
        { user: w.user },
      );
      expect(
        service.hostOf(row, await service.getEnvironment(row, staging.id)),
      ).toBe(main.id);
    });

    it("refuses a host the project was never lent", async ({ expect }) => {
      const w = await stackWorld(alepha);
      const foreign = await lentBayHost(w, { lend: false });
      await expect(
        createStack(alepha, w, { hostId: foreign.id }),
      ).rejects.toThrow("no such host");
      const stack = await createStack(alepha, w, { name: "app" });
      await expect(
        createEnvironment(alepha, w, stack.id, {
          env: "production",
          hostId: foreign.id,
        }),
      ).rejects.toThrow("no such host");
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

  describe("deleting the host a stack deploys to (#Q3131)", () => {
    it("is refused while a stack names it as its default, naming the stack", async ({
      expect,
    }) => {
      const w = await stackWorld(alepha);
      const host = await lentBayHost(w);
      await createStack(alepha, w, { name: "umami", hostId: host.id });

      await expect(
        alepha
          .inject(HostController)
          .deleteHost.fetch({ params: { hostId: host.id } }, { user: w.user }),
      ).rejects.toThrow("still the deploy target of umami (stack)");
    });

    it("is refused while an environment overrides to it, naming stack/env", async ({
      expect,
    }) => {
      const w = await stackWorld(alepha);
      const main = await lentBayHost(w);
      const cheap = await lentBayHost(w);
      const stack = await createStack(alepha, w, {
        name: "umami",
        hostId: main.id,
      });
      await createEnvironment(alepha, w, stack.id, {
        env: "staging",
        hostId: cheap.id,
      });

      await expect(
        alepha
          .inject(HostController)
          .deleteHost.fetch({ params: { hostId: cheap.id } }, { user: w.user }),
      ).rejects.toThrow("still the deploy target of umami/staging (stack)");
    });

    it("goes through once no stack points at it any more", async ({
      expect,
    }) => {
      const w = await stackWorld(alepha);
      const host = await lentBayHost(w);
      const stack = await createStack(alepha, w, { hostId: host.id });
      await alepha
        .inject(StackController)
        .deleteStack.fetch(
          { params: { projectId: w.project.id, stackId: stack.id } },
          { user: w.user },
        );

      const deleted = await alepha
        .inject(HostController)
        .deleteHost.fetch({ params: { hostId: host.id } }, { user: w.user });
      expect(deleted.data).toEqual({ ok: true });
    });
  });

  describe("a test hostname (#Q3137)", () => {
    const route = (
      w: Awaited<ReturnType<typeof stackWorld>>,
      ids: {
        stackId: string;
        environmentId: string;
      },
    ) =>
      alepha.inject(StackController).addStackTestRoute.fetch(
        {
          params: { projectId: w.project.id, ...ids },
          body: { service: "web" },
        },
        { user: w.user },
      );

    it("routes <env>-<stack>.<ip>.sslip.io to the service, once", async ({
      expect,
    }) => {
      const w = await stackWorld(alepha);
      const host = await lentBayHost(w);
      await w.rows.hosts.updateById(host.id, { publicIp: "203.0.113.10" });
      const stack = await createStack(alepha, w, {
        name: "umami",
        hostId: host.id,
      });
      const env = await createEnvironment(alepha, w, stack.id, {
        env: "production",
      });
      const ids = { stackId: stack.id, environmentId: env.id };

      const first = (await route(w, ids)).data;
      const again = (await route(w, ids)).data;

      expect(first.routes).toEqual([
        expect.objectContaining({
          service: "web",
          domain: "production-umami.203-0-113-10.sslip.io",
        }),
      ]);
      expect(again.routes).toHaveLength(1);
    });

    it("refuses while the host's address is unknown, naming lore host wait", async ({
      expect,
    }) => {
      const w = await stackWorld(alepha);
      const host = await lentBayHost(w);
      const stack = await createStack(alepha, w, { hostId: host.id });
      const env = await createEnvironment(alepha, w, stack.id, {
        env: "production",
      });
      await expect(
        route(w, { stackId: stack.id, environmentId: env.id }),
      ).rejects.toThrow(`lore host wait ${host.slug}`);
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
      const stack = await createStack(alepha, w, { name: "crm" });
      const staging = await createEnvironment(alepha, w, stack.id, {
        env: "staging",
      });
      const api = await createInstance(alepha, w, "crm-api", "staging");
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
        { id: api.id, app: "crm-api", env: "staging" },
      ]);
      expect(
        (await w.rows.instances.findById(api.id))?.stackEnvironmentId,
      ).toBe(staging.id);
    });

    it("refuses an app of another env name, of another project, or already in another environment", async ({
      expect,
    }) => {
      const w = await stackWorld(alepha);
      const stack = await createStack(alepha, w, { name: "crm" });
      const production = await createEnvironment(alepha, w, stack.id, {
        env: "production",
      });
      const other = await createStack(alepha, w, { name: "other" });
      const otherProd = await createEnvironment(alepha, w, other.id, {
        env: "production",
      });
      const staging = await createInstance(alepha, w, "crm-api", "staging");
      const prod = await createInstance(alepha, w, "crm-api", "production");
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
        "crm-api",
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

    it("refuses to delete a stack while an environment remains, naming it (#Q3136)", async ({
      expect,
    }) => {
      const w = await stackWorld(alepha);
      const stack = await createStack(alepha, w, { name: "crm" });
      await createEnvironment(alepha, w, stack.id, { env: "production" });
      await createEnvironment(alepha, w, stack.id, { env: "staging" });

      await expect(
        alepha
          .inject(StackController)
          .deleteStack.fetch(
            { params: { projectId: w.project.id, stackId: stack.id } },
            { user: w.user },
          ),
      ).rejects.toThrow(
        "Stack crm still has environments: production, staging. Forget each first with lore stack destroy --name crm --env production, then lore stack destroy --name crm --env staging.",
      );
      expect(
        await w.rows.environments.findMany({
          where: { stackId: { eq: stack.id } },
        }),
      ).toHaveLength(2);
    });

    it("leaves members as ordinary copies once their environment is forgotten and the stack deleted", async ({
      expect,
    }) => {
      const w = await stackWorld(alepha);
      const stack = await createStack(alepha, w, { name: "crm" });
      const production = await createEnvironment(alepha, w, stack.id, {
        env: "production",
      });
      const api = await createInstance(alepha, w, "crm-api", "production");
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
      await alepha.inject(StackController).deleteStackEnvironment.fetch(
        {
          params: {
            projectId: w.project.id,
            stackId: stack.id,
            environmentId: production.id,
          },
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

      const off = await stackWorld(alepha, { stacks: false });
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
