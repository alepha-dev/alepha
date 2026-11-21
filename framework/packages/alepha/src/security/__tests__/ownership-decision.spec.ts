import { $pipeline, Alepha, z } from "alepha";
import { $entity, $repository, db } from "alepha/orm";
import { $action, AlephaServer, ServerProvider } from "alepha/server";
import { describe, it } from "vitest";

import {
  $issuer,
  $owns,
  $secure,
  AlephaSecurity,
  currentUserAtom,
  EffectivePermissionsProvider,
  type UserAccountToken,
} from "../index.ts";

/**
 * An ownership decision belongs to the permission check that produced it.
 *
 * `member` reads documents it owns (`docs:read`, `ownership: true`) and reads
 * reports without restriction (`report:read`). The unrestricted answer for a
 * report must never let it past the owner check of a document.
 */
const docs = $entity({
  name: "ownership_decision_docs",
  schema: z.object({
    id: db.primaryKey(z.text()),
    createdBy: z.text(),
    title: z.text(),
  }),
});

const roles = [
  {
    name: "member",
    permissions: [
      { name: "docs:read", ownership: true },
      { name: "report:read" },
    ],
  },
  { name: "admin", permissions: [{ name: "*" }] },
];

const owner: UserAccountToken = { id: "u1", realm: "app", roles: ["member"] };
const stranger: UserAccountToken = {
  id: "u2",
  realm: "app",
  roles: ["member"],
};
const admin: UserAccountToken = { id: "u3", realm: "app", roles: ["admin"] };

const createPipelines = async () => {
  const alepha = Alepha.create({
    env: { DATABASE_URL: "sqlite://:memory:", LOG_LEVEL: "error" },
  });

  class Service {
    docs = $repository(docs);
    effective = alepha.inject(EffectivePermissionsProvider);

    realm = $issuer({
      name: "app",
      secret: "ownership-decision-test-secret-0123456789",
      roles,
    });

    // No permission of its own: the owner check is the whole answer.
    read = $pipeline({
      use: [
        $owns({ repository: () => this.docs, param: "id", owner: "createdBy" }),
      ],
      handler: async () => "doc",
    });

    // The same gate, naming the permission the row is read under.
    readAs = $pipeline({
      use: [
        $owns({
          repository: () => this.docs,
          param: "id",
          owner: "createdBy",
          requires: "docs:read",
        }),
      ],
      handler: async () => "doc",
    });

    // A permission check beside the gate, in the same list.
    readBeside = $pipeline({
      use: [
        $secure({ permissions: ["report:read"] }),
        $owns({ repository: () => this.docs, param: "id", owner: "createdBy" }),
      ],
      handler: async () => "doc",
    });

    report = $pipeline({
      use: [$secure({ permissions: ["report:read"] })],
      handler: async () => alepha.store.get(currentUserAtom)?.ownership,
    });

    reportThenRead = $pipeline({
      use: [$secure({ permissions: ["report:read"] })],
      handler: async () => this.read(),
    });

    bare = $pipeline({
      use: [$secure()],
      handler: async () => alepha.store.get(currentUserAtom)?.ownership,
    });

    reportThenBare = $pipeline({
      use: [$secure({ permissions: ["report:read"] })],
      handler: async () => this.bare(),
    });

    reportThenEffective = $pipeline({
      use: [$secure({ permissions: ["report:read"] })],
      handler: async () =>
        this.effective.resolve({
          user: alepha.store.get(currentUserAtom)!,
          narrow: [() => false],
        }),
    });
  }

  alepha.with(AlephaSecurity);
  const service = alepha.inject(Service);
  await alepha.start();
  await service.docs.create({ id: "d1", createdBy: "u1", title: "of u1" });

  const as = <T>(user: UserAccountToken, fn: () => Promise<T>): Promise<T> =>
    alepha.context.run(async () => {
      alepha.store.set(currentUserAtom, user);
      alepha.store.set("alepha.http.request", {
        params: { id: "d1" },
        query: {},
      } as any);
      return fn();
    });

  return { alepha, service, as };
};

describe("ownership decision", () => {
  describe("two gates in one context", () => {
    it("refuses a stranger at the owner gate, called alone", async ({
      expect,
    }) => {
      const { service, as } = await createPipelines();
      await expect(as(stranger, () => service.read())).rejects.toThrow(
        "Not the owner of this resource",
      );
    });

    it("refuses a stranger at the owner gate after an unrelated unrestricted permission passed", async ({
      expect,
    }) => {
      const { service, as } = await createPipelines();
      await expect(
        as(stranger, async () => {
          expect(await service.report()).toBe(false);
          return service.read();
        }),
      ).rejects.toThrow("Not the owner of this resource");
    });

    it("refuses a stranger whichever gate ran first", async ({ expect }) => {
      const { service, as } = await createPipelines();
      await as(stranger, async () => {
        await expect(service.read()).rejects.toThrow(
          "Not the owner of this resource",
        );
        expect(await service.report()).toBe(false);
        await expect(service.read()).rejects.toThrow(
          "Not the owner of this resource",
        );
      });
    });

    it("refuses a stranger at an owner gate reached from inside the other pipeline", async ({
      expect,
    }) => {
      const { service, as } = await createPipelines();
      await expect(
        as(stranger, () => service.reportThenRead()),
      ).rejects.toThrow("Not the owner of this resource");
    });

    it("refuses a stranger when the permission check sits beside the gate rather than in it", async ({
      expect,
    }) => {
      const { service, as } = await createPipelines();
      await expect(as(stranger, () => service.readBeside())).rejects.toThrow(
        "Not the owner of this resource",
      );
    });

    it("gives a gate with no permission no ownership decision to hand its handler", async ({
      expect,
    }) => {
      const { service, as } = await createPipelines();
      expect(await as(stranger, () => service.reportThenBare())).toBe(
        undefined,
      );
    });
  });

  describe("what still passes", () => {
    it("lets the owner read their own row, before and after another gate", async ({
      expect,
    }) => {
      const { service, as } = await createPipelines();
      await as(owner, async () => {
        expect(await service.read()).toBe("doc");
        await service.report();
        expect(await service.read()).toBe("doc");
        expect(await service.readAs()).toBe("doc");
      });
    });

    it("lets an unrestricted grant on the gate's own permission skip the owner check", async ({
      expect,
    }) => {
      const { service, as } = await createPipelines();
      expect(await as(admin, () => service.readAs())).toBe("doc");
    });

    it("refuses a stranger whose grant on the gate's own permission is owner-scoped", async ({
      expect,
    }) => {
      const { service, as } = await createPipelines();
      await expect(
        as(stranger, async () => {
          await service.report();
          return service.readAs();
        }),
      ).rejects.toThrow("Not the owner of this resource");
    });

    it("keeps the ownership an identity was given, through a gate that decided otherwise", async ({
      expect,
    }) => {
      const { alepha, service } = await createPipelines();
      const operator: UserAccountToken = { ...stranger, ownership: false };
      // Handed in as the request's user: the object itself, as `run()` does.
      await alepha.context.run(async () => {
        alepha.store.set("alepha.http.request", {
          params: { id: "d1" },
          query: {},
          user: operator,
        } as any);

        expect(await service.read()).toBe("doc");
        // `docs:read` is owner-scoped for this role: that answer is the
        // gate's own, and it neither uses nor replaces the identity's.
        await expect(service.readAs()).rejects.toThrow(
          "Not the owner of this resource",
        );
        expect(await service.bare()).toBe(false);
        expect(await service.read()).toBe("doc");
      });
    });

    it("keeps the ownership of a hand-built identity written to the atom", async ({
      expect,
    }) => {
      const { alepha, service, as } = await createPipelines();
      const operator: UserAccountToken = { ...stranger, ownership: false };
      // `as` sets `currentUserAtom` to the identity as it was built.
      await as(operator, async () => {
        expect(alepha.store.get(currentUserAtom)?.ownership).toBe(false);
        expect(await service.read()).toBe("doc");
      });
    });
  });

  describe("EffectivePermissionsProvider", () => {
    it("does not read one permission's unrestricted answer as a privileged identity", async ({
      expect,
    }) => {
      const { service, as } = await createPipelines();
      // `report:read` is unrestricted for the role and keeps skipping the
      // narrowing factors; `docs:read` is owner-scoped and does not.
      expect(await as(stranger, () => service.reportThenEffective())).toEqual([
        "report:read",
      ]);
    });

    it("keeps the whole catalogue for a role holding everything", async ({
      expect,
    }) => {
      const { service, as } = await createPipelines();
      expect(await as(admin, () => service.reportThenEffective())).toEqual([
        "docs:read",
        "report:read",
      ]);
    });
  });

  describe("over HTTP, through another action's run()", () => {
    const createServer = async () => {
      const alepha = Alepha.create({
        env: {
          DATABASE_URL: "sqlite://:memory:",
          LOG_LEVEL: "error",
          SERVER_PORT: 0,
        },
      });

      class App {
        docs = $repository(docs);

        realm = $issuer({
          name: "app",
          secret: "ownership-decision-test-secret-0123456789",
          roles,
        });

        read = $action({
          method: "GET",
          path: "/docs/:id",
          schema: {
            params: z.object({ id: z.text() }),
            response: z.object({ title: z.text() }),
          },
          use: [
            $secure(),
            $owns({
              repository: () => this.docs,
              param: "id",
              owner: "createdBy",
            }),
          ],
          handler: async ({ params }) => ({
            title: (await this.docs.findById(params.id))!.title,
          }),
        });

        report = $action({
          method: "GET",
          path: "/report/:id",
          schema: {
            params: z.object({ id: z.text() }),
            response: z.object({ title: z.text() }),
          },
          use: [$secure({ permissions: ["report:read"] })],
          handler: async ({ params }) =>
            this.read.run({ params: { id: params.id } }),
        });

        // The same, handing the inner action the user this handler received.
        reportAs = $action({
          method: "GET",
          path: "/report-as/:id",
          schema: {
            params: z.object({ id: z.text() }),
            response: z.object({ title: z.text() }),
          },
          use: [$secure({ permissions: ["report:read"] })],
          handler: async ({ params, user }) =>
            this.read.run({ params: { id: params.id } }, { user }),
        });

        // The same, naming the user of the HTTP request.
        reportContext = $action({
          method: "GET",
          path: "/report-context/:id",
          schema: {
            params: z.object({ id: z.text() }),
            response: z.object({ title: z.text() }),
          },
          use: [$secure({ permissions: ["report:read"] })],
          handler: async ({ params }) =>
            this.read.run({ params: { id: params.id } }, { user: "context" }),
        });
      }

      alepha.with(AlephaServer);
      alepha.with(AlephaSecurity);
      const app = alepha.inject(App);
      await alepha.start();
      await app.docs.create({ id: "d1", createdBy: "u1", title: "of u1" });

      const host = alepha.inject(ServerProvider).hostname;
      const call = async (user: UserAccountToken, path: string) => {
        const { access_token } = await app.realm.createToken({
          id: user.id,
          roles: user.roles,
        });
        const response = await fetch(`${host}${path}`, {
          headers: { authorization: `Bearer ${access_token}` },
        });
        return { status: response.status, body: await response.json() };
      };

      return { alepha, app, call };
    };

    it("refuses a stranger on the owner-gated route and on the route that runs it", async ({
      expect,
    }) => {
      const { alepha, call } = await createServer();

      expect((await call(stranger, "/api/docs/d1")).status).toBe(403);

      const through = await call(stranger, "/api/report/d1");
      expect(through.status).toBe(403);
      expect(JSON.stringify(through.body)).not.toContain("of u1");

      await alepha.stop();
    });

    it("refuses a stranger when the handler passes its own user to the inner action", async ({
      expect,
    }) => {
      const { alepha, call } = await createServer();

      expect((await call(stranger, "/api/report-as/d1")).status).toBe(403);
      expect((await call(stranger, "/api/report-context/d1")).status).toBe(403);
      expect((await call(owner, "/api/report-as/d1")).status).toBe(200);
      expect((await call(owner, "/api/report-context/d1")).status).toBe(200);

      await alepha.stop();
    });

    it("answers the owner on both routes", async ({ expect }) => {
      const { alepha, call } = await createServer();

      expect(await call(owner, "/api/docs/d1")).toEqual({
        status: 200,
        body: { title: "of u1" },
      });
      expect(await call(owner, "/api/report/d1")).toEqual({
        status: 200,
        body: { title: "of u1" },
      });

      await alepha.stop();
    });

    it("refuses a stranger when the inner action is run with the caller's own identity", async ({
      expect,
    }) => {
      const { alepha, app } = await createServer();

      await expect(
        app.report.run({ params: { id: "d1" } }, { user: stranger }),
      ).rejects.toThrow("Not the owner of this resource");

      await alepha.stop();
    });
  });
});
