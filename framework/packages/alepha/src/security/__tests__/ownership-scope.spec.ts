import { $pipeline, Alepha, z } from "alepha";
import { $entity, $repository, db } from "alepha/orm";
import {
  $action,
  AlephaServer,
  helmetOptions,
  ServerHelmetProvider,
  ServerProvider,
} from "alepha/server";
import { describe, it } from "vitest";

import {
  $issuer,
  $owns,
  $secure,
  AlephaSecurity,
  currentUserAtom,
  SecurityProvider,
  type UserAccountToken,
  userAccountInfoSchema,
} from "../index.ts";

/**
 * What a gate publishes: never a wider answer than it found, only while it
 * runs, and in a form a copy cannot carry.
 *
 * The tests marked "Guard" pass on the code before the ownership fix as well:
 * they pin what a fix of that bug must not take away.
 *
 * `member` reads documents it owns (`docs:read`, `ownership: true`) and reads
 * reports without restriction (`report:read`).
 */
const docs = $entity({
  name: "ownership_scope_docs",
  schema: z.object({
    id: db.primaryKey(z.text()),
    createdBy: z.text(),
    title: z.text(),
  }),
});

const owner: UserAccountToken = { id: "u1", realm: "app", roles: ["member"] };
const stranger: UserAccountToken = {
  id: "u2",
  realm: "app",
  roles: ["member"],
};

// Privileged by declaration: built by hand, never by a permission check.
const operator: UserAccountToken = { ...stranger, ownership: false };

const setup = async () => {
  const alepha = Alepha.create({
    env: { DATABASE_URL: "sqlite://:memory:", LOG_LEVEL: "error" },
  });

  const seen = (user: UserAccountToken | undefined) =>
    `${user?.ownership}/${alepha.store.get(currentUserAtom)?.ownership}`;

  class App {
    docs = $repository(docs);

    realm = $issuer({
      name: "app",
      secret: "ownership-scope-test-secret-0123456789",
      roles: [
        {
          name: "member",
          permissions: [
            { name: "docs:read", ownership: true },
            { name: "report:read" },
          ],
        },
        { name: "admin", permissions: [{ name: "*" }] },
      ],
    });

    // An owner-scoped permission check, then a gate that declares none.
    besideBare = $action({
      method: "GET",
      path: "/besideBare",
      use: [$secure({ permissions: ["docs:read"] }), $secure()],
      handler: async ({ user }) => seen(user),
    });

    besideGuard = $action({
      method: "GET",
      path: "/besideGuard",
      use: [
        $secure({ permissions: ["docs:read"] }),
        $secure({ guard: () => true }),
      ],
      handler: async ({ user }) => seen(user),
    });

    besideRoles = $action({
      method: "GET",
      path: "/besideRoles",
      use: [
        $secure({ permissions: ["docs:read"] }),
        $secure({ roles: ["member"] }),
      ],
      handler: async ({ user }) => seen(user),
    });

    besideIssuers = $action({
      method: "GET",
      path: "/besideIssuers",
      use: [
        $secure({ permissions: ["docs:read"] }),
        $secure({ issuers: ["app"] }),
      ],
      handler: async ({ user }) => seen(user),
    });

    besideOwns = $action({
      method: "GET",
      path: "/besideOwns/:id",
      schema: { params: z.object({ id: z.text() }) },
      use: [
        $secure({ permissions: ["docs:read"] }),
        $owns({ repository: () => this.docs, param: "id", owner: "createdBy" }),
      ],
      handler: async ({ user }) => seen(user),
    });

    bare = $pipeline({
      use: [$secure()],
      handler: async () => `${alepha.store.get(currentUserAtom)?.ownership}`,
    });

    unrestricted = $pipeline({
      use: [$secure({ permissions: ["report:read"] })],
      handler: async () => `${alepha.store.get(currentUserAtom)?.ownership}`,
    });

    // An owner-scoped action whose handler calls a gated pipeline: what it
    // sees before, what the pipeline saw, what it sees after.
    aroundBare = $action({
      method: "GET",
      path: "/aroundBare",
      use: [$secure({ permissions: ["docs:read"] })],
      handler: async (request) => {
        const before = seen(request.user);
        const inside = await this.bare();
        return `${before} ${inside} ${seen(request.user)}`;
      },
    });

    aroundUnrestricted = $action({
      method: "GET",
      path: "/aroundUnrestricted",
      use: [$secure({ permissions: ["docs:read"] })],
      handler: async (request) => {
        const before = seen(request.user);
        const inside = await this.unrestricted();
        return `${before} ${inside} ${seen(request.user)}`;
      },
    });

    read = $action({
      method: "GET",
      path: "/docs/:id",
      schema: { params: z.object({ id: z.text() }) },
      use: [
        $secure(),
        $owns({ repository: () => this.docs, param: "id", owner: "createdBy" }),
      ],
      handler: async () => "doc",
    });

    adminOnly = $pipeline({
      use: [$secure({ roles: ["admin"] })],
      handler: async () => `ran as ${alepha.store.get(currentUserAtom)?.id}`,
    });

    // Steps down: the handler replaces the current user, then calls on.
    stepDown = $action({
      method: "GET",
      path: "/stepDown",
      use: [$secure({ permissions: ["report:read"] })],
      handler: async () => {
        alepha.store.set(currentUserAtom, stranger);
        const now = alepha.store.get(currentUserAtom)?.id;
        return `${now} ${await this.adminOnly().catch((e: Error) => e.message)}`;
      },
    });

    // The same through `storeUserInContext`, inside a pipeline's gate.
    stepDownPipeline = $pipeline({
      use: [$secure({ permissions: ["report:read"] })],
      handler: async () => {
        alepha.inject(SecurityProvider).storeUserInContext(stranger);
        return alepha.store.get(currentUserAtom)?.id;
      },
    });

    // A handler that writes on the user its gate gave it.
    narrows = $action({
      method: "GET",
      path: "/narrows",
      use: [$secure({ permissions: ["report:read"] })],
      handler: async ({ user }) => {
        user.ownership = true;
        Object.assign(user, { ownership: "team" });
        return `${user.ownership}`;
      },
    });

    asSystem = $action({
      method: "GET",
      path: "/asSystem",
      use: [$secure({ permissions: ["report:read"] })],
      handler: async () =>
        this.read.run({ params: { id: "d1" } }, { user: "system" }),
    });

    asLiteral = $action({
      method: "GET",
      path: "/asLiteral",
      use: [$secure({ permissions: ["report:read"] })],
      handler: async () =>
        this.read.run({ params: { id: "d1" } }, { user: operator }),
    });

    // Hands the owner-gated action whatever `copy` makes of the user this
    // handler received, which carries an unrestricted decision.
    copy: (user: UserAccountToken) => UserAccountToken | "atom" = (user) =>
      user;

    viaCopy = $action({
      method: "GET",
      path: "/viaCopy",
      use: [$secure({ permissions: ["report:read"] })],
      handler: async ({ user }) => {
        const copied = this.copy(user);
        if (copied === "atom") {
          return alepha.context.run(async () => {
            alepha.store.set(currentUserAtom, user);
            return this.read.run({ params: { id: "d1" } });
          });
        }
        return this.read.run({ params: { id: "d1" } }, { user: copied });
      },
    });
  }

  alepha.with(AlephaServer);
  alepha.with(AlephaSecurity);
  const app = alepha.inject(App);
  await alepha.start();
  await app.docs.create({ id: "d1", createdBy: "u1", title: "of u1" });

  return { alepha, app, security: alepha.inject(SecurityProvider) };
};

describe("ownership scope", () => {
  describe("a gate with no permission keeps the restriction it found", () => {
    // Guard: true before the ownership fix too, and must stay true.
    it("keeps an owner-scoped decision after a bare $secure()", async ({
      expect,
    }) => {
      const { app } = await setup();
      expect(await app.besideBare.run({}, { user: owner })).toBe("true/true");
    });

    // Guard: true before the ownership fix too, and must stay true.
    it("keeps it after a guard, a role check and an issuer check", async ({
      expect,
    }) => {
      const { app } = await setup();
      expect(await app.besideGuard.run({}, { user: owner })).toBe("true/true");
      expect(await app.besideRoles.run({}, { user: owner })).toBe("true/true");
      expect(await app.besideIssuers.run({}, { user: owner })).toBe(
        "true/true",
      );
    });

    // Guard: true before the ownership fix too, and must stay true.
    it("keeps it after an $owns gate without requires", async ({ expect }) => {
      const { app } = await setup();
      expect(
        await app.besideOwns.run({ params: { id: "d1" } }, { user: owner }),
      ).toBe("true/true");
    });
  });

  describe("a gate publishes to what runs under it", () => {
    // Guard: true before the ownership fix too, and must stay true.
    it("leaves the enclosing action its own decision after a bare gate ran inside it", async ({
      expect,
    }) => {
      const { app } = await setup();
      expect(await app.aroundBare.run({}, { user: owner })).toBe(
        "true/true true true/true",
      );
    });

    it("leaves the enclosing action its own decision after an unrestricted check ran inside it", async ({
      expect,
    }) => {
      const { app } = await setup();
      expect(await app.aroundUnrestricted.run({}, { user: owner })).toBe(
        "true/true false true/true",
      );
    });
  });

  describe("a copy of a gate's user carries no unrestricted decision", () => {
    const copies: Array<
      [string, (user: UserAccountToken) => UserAccountToken]
    > = [
      ["a spread", (user) => ({ ...user })],
      ["a JSON round trip", (user) => JSON.parse(JSON.stringify(user))],
      ["structuredClone", (user) => structuredClone(user)],
      ["Object.assign", (user) => Object.assign({}, user)],
    ];

    for (const [name, copy] of copies) {
      it(`refuses a stranger handed on as ${name}`, async ({ expect }) => {
        const { app } = await setup();
        app.copy = (user) => {
          const copied = copy(user);
          expect(copied.ownership).toBe(undefined);
          return copied;
        };

        await expect(app.viaCopy.run({}, { user: stranger })).rejects.toThrow(
          "Not the owner of this resource",
        );
        expect(await app.viaCopy.run({}, { user: owner })).toBe("doc");
      });
    }

    it("refuses a stranger handed on as the user schema's decode, which reads the field", async ({
      expect,
    }) => {
      const { alepha, app } = await setup();
      // A decode reads `ownership` like a handler does, so its output has
      // the field: under the gate that produced the user, it is not believed.
      app.copy = (user) =>
        alepha.codec.decode(userAccountInfoSchema, user) as UserAccountToken;

      await expect(app.viaCopy.run({}, { user: stranger })).rejects.toThrow(
        "Not the owner of this resource",
      );
      expect(await app.viaCopy.run({}, { user: owner })).toBe("doc");
    });

    it("refuses a stranger whose user was written to the atom by hand", async ({
      expect,
    }) => {
      const { app } = await setup();
      app.copy = () => "atom";

      await expect(app.viaCopy.run({}, { user: stranger })).rejects.toThrow(
        "Not the owner of this resource",
      );
    });

    it("refuses a stranger handed on as the very object the handler received", async ({
      expect,
    }) => {
      const { app } = await setup();
      let received: UserAccountToken | undefined;
      app.copy = (user) => {
        received = user;
        return user;
      };

      await expect(app.viaCopy.run({}, { user: stranger })).rejects.toThrow(
        "Not the owner of this resource",
      );
      // The handler itself still reads its gate's answer.
      expect(received?.ownership).toBe(false);
    });

    // Guard: true before the ownership fix too, and must stay true.
    it("believes an identity built with ownership: false from inside a gated handler too", async ({
      expect,
    }) => {
      const { alepha, app } = await setup();
      alepha.store.set("alepha.security.system.user", operator);

      expect(await app.asSystem.run({}, { user: stranger })).toBe("doc");
      expect(await app.asLiteral.run({}, { user: stranger })).toBe("doc");
    });

    it("does not believe a user carrying a forged marker", async ({
      expect,
    }) => {
      const { app } = await setup();
      app.copy = (user) => {
        const forged: UserAccountToken = { ...user };
        Object.defineProperty(forged, "ownership", { value: false });
        Object.defineProperty(
          forged,
          Symbol.for("alepha.security.identityOwnership"),
          { value: false },
        );
        return forged;
      };

      await expect(app.viaCopy.run({}, { user: stranger })).rejects.toThrow(
        "Not the owner of this resource",
      );
    });

    // Guard: true before the ownership fix too, and must stay true.
    it("lets a handler write ownership on the user its gate gave it", async ({
      expect,
    }) => {
      const { app } = await setup();
      expect(await app.narrows.run({}, { user: stranger })).toBe("team");
    });

    // Guard: true before the ownership fix too, and must stay true.
    it("still admits an identity built with ownership: false", async ({
      expect,
    }) => {
      const { app } = await setup();

      expect(
        await app.read.run({ params: { id: "d1" } }, { user: operator }),
      ).toBe("doc");
      expect(
        await app.read.run(
          { params: { id: "d1" } },
          { user: structuredClone(operator) },
        ),
      ).toBe("doc");
    });
  });

  describe("a write to the current user under a gate", () => {
    const admin: UserAccountToken = {
      id: "u9",
      realm: "app",
      roles: ["admin"],
    };

    // Guard: true before the ownership fix too, and must stay true.
    it("takes effect for the rest of the gate: the next gate sees the new user", async ({
      expect,
    }) => {
      const { app } = await setup();
      expect(await app.stepDown.run({}, { user: admin })).toBe(
        "u2 One of roles 'admin' required",
      );
    });

    it("is gone once the gate returns, and the enclosing context is untouched", async ({
      expect,
    }) => {
      const { alepha, app } = await setup();

      await alepha.context.run(async () => {
        alepha.store.set(currentUserAtom, admin);
        const before = alepha.store.get(currentUserAtom);

        expect(await app.stepDownPipeline()).toBe("u2");

        expect(alepha.store.get(currentUserAtom)).toBe(before);
        expect(await app.adminOnly()).toBe("ran as u9");
      });
    });
  });

  describe("a permission answered while building the user", () => {
    it("does not make a built user privileged once stored in the context", async ({
      expect,
    }) => {
      const { alepha, app, security } = await setup();
      const { access_token } = await app.realm.createToken({
        id: "u2",
        roles: ["member"],
      });
      const built = await security.createUserFromToken(access_token, {
        realm: "app",
        permission: "report:read",
      });

      await alepha.context.run(async () => {
        security.storeUserInContext(built);
        expect(alepha.store.get(currentUserAtom)?.ownership).toBe(undefined);
        await expect(app.read.run({ params: { id: "d1" } })).rejects.toThrow(
          "Not the owner of this resource",
        );
      });
    });

    it("does not make a built user privileged through the user schema's decode", async ({
      expect,
    }) => {
      const { alepha, app, security } = await setup();
      const { access_token } = await app.realm.createToken({
        id: "u2",
        roles: ["member"],
      });
      const built = await security.createUserFromToken(access_token, {
        realm: "app",
        permission: "report:read",
      });
      const resolved = await security.resolveUserFromServerRequest(
        {
          url: "http://localhost/",
          headers: { authorization: `Bearer ${access_token}` },
        },
        { permission: "report:read" },
      );

      for (const user of [built, resolved!]) {
        const decoded = alepha.codec.decode(
          userAccountInfoSchema,
          user,
        ) as UserAccountToken;
        expect(decoded.ownership).toBe(undefined);
        await expect(
          app.read.run({ params: { id: "d1" } }, { user: decoded }),
        ).rejects.toThrow("Not the owner of this resource");
      }
    });

    it("does not make a user from createUserFromToken privileged", async ({
      expect,
    }) => {
      const { app, security } = await setup();
      const { access_token } = await app.realm.createToken({
        id: "u2",
        roles: ["member"],
      });

      const user = await security.createUserFromToken(access_token, {
        realm: "app",
        permission: "report:read",
      });
      expect(user.ownership).toBe(false);
      expect(user.token).toBe(access_token);

      await expect(
        app.read.run({ params: { id: "d1" } }, { user }),
      ).rejects.toThrow("Not the owner of this resource");
      await expect(
        app.read.run({ params: { id: "d1" } }, { user: { ...user } }),
      ).rejects.toThrow("Not the owner of this resource");
    });

    it("does not make a user from resolveUserFromServerRequest privileged", async ({
      expect,
    }) => {
      const { app, security } = await setup();
      const { access_token } = await app.realm.createToken({
        id: "u2",
        roles: ["member"],
      });

      const user = await security.resolveUserFromServerRequest(
        {
          url: "http://localhost/",
          headers: { authorization: `Bearer ${access_token}` },
        },
        { permission: "report:read" },
      );
      expect(user?.ownership).toBe(false);

      await expect(
        app.read.run({ params: { id: "d1" } }, { user }),
      ).rejects.toThrow("Not the owner of this resource");
      await expect(
        app.read.run({ params: { id: "d1" } }, { user: { ...user! } }),
      ).rejects.toThrow("Not the owner of this resource");
    });
  });

  describe("the request a nested gate runs inside", () => {
    // Guard: true before the ownership fix too, and must stay true. A
    // WebSocket upgrade reads who connected there.
    it("keeps the user a gate resolved when the request carried none", async ({
      expect,
    }) => {
      const { alepha, app } = await setup();

      await alepha.context.run(async () => {
        const request: { user?: UserAccountToken } = {};
        alepha.store.set("alepha.http.request", request as never);
        alepha.store.set(currentUserAtom, owner);

        await app.bare();

        expect(request.user?.id).toBe("u1");
      });
    });

    // Guard: true before the ownership fix too, and must stay true.
    it("stays the request itself: the CSP nonce read under the gate is the response's", async ({
      expect,
    }) => {
      const alepha = Alepha.create({
        env: { LOG_LEVEL: "error", SERVER_PORT: 0 },
      });

      class App {
        realm = $issuer({
          name: "app",
          secret: "ownership-scope-test-secret-0123456789",
          roles: [{ name: "member", permissions: [] }],
        });

        nonce = $pipeline({
          use: [$secure()],
          handler: async () =>
            alepha.inject(ServerHelmetProvider).cspNonce() ?? "none",
        });

        page = $action({
          method: "GET",
          path: "/nonce",
          schema: { response: z.object({ nonce: z.text() }) },
          use: [$secure()],
          handler: async () => ({ nonce: await this.nonce() }),
        });
      }

      alepha.with(AlephaServer);
      alepha.with(AlephaSecurity);
      alepha.store.set(helmetOptions, { contentSecurityPolicy: {} });
      const app = alepha.inject(App);
      await alepha.start();

      const { access_token } = await app.realm.createToken({
        id: "u1",
        roles: ["member"],
      });
      const response = await fetch(
        `${alepha.inject(ServerProvider).hostname}/api/nonce`,
        { headers: { authorization: `Bearer ${access_token}` } },
      );
      const { nonce } = (await response.json()) as { nonce: string };

      expect(nonce).not.toBe("none");
      expect(response.headers.get("content-security-policy")).toContain(
        `'nonce-${nonce}'`,
      );

      await alepha.stop();
    });
  });
});
