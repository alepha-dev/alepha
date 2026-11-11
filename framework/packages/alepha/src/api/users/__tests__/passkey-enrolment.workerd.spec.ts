import { Alepha } from "alepha";
import { DatabaseProvider, DrizzleKitProvider } from "alepha/orm";
import {
  AlephaTestingWebAuthn,
  MemoryAuthenticator,
} from "alepha/testing/webauthn";
import { describe, it } from "vitest";

import { withWorkerd } from "../../../ai/core/__tests__/workerdHarness.ts";
import { $realm, AlephaApiUsers } from "../index.ts";

/**
 * Passkey enrolment on workerd, against D1: the challenge cookie is set by
 * one request and read by the next (signed, encrypted, nothing kept in the
 * isolate), and the registration is verified with workerd's WebCrypto.
 *
 * D1 is not migrated on Workers, so the tables are created first from the
 * statements the ORM generates for this module on SQLite.
 */
describe("alepha/api/users passkey enrolment (workerd)", () => {
  it("adds a passkey across two requests, through the challenge cookie", async ({
    expect,
  }) => {
    const node = Alepha.create({
      env: { DATABASE_URL: "sqlite://:memory:" },
    })
      .with(AlephaApiUsers)
      // The realm registers the audit tables too.
      .with(() => ({ realm: $realm({ settings: { passkeys: "optional" } }) }));
    const { statements } = await node
      .inject(DrizzleKitProvider)
      .generateMigration(node.inject(DatabaseProvider));

    const device = Alepha.create()
      .with(AlephaTestingWebAuthn)
      .inject(MemoryAuthenticator);
    device.origin = "http://ai.test";

    const result = await withWorkerd(
      {
        name: "passkey-enrolment",
        config: {
          env: {
            DB: { type: "d1", id: "passkey-enrolment-test" },
            ALEPHA_ACTOR: {
              type: "durable-object",
              worker: "passkey-enrolment",
              exportName: "AlephaActorDurableObject",
            },
            APP_NAME: { type: "json", value: "passkey-enrolment" },
            APP_SECRET: {
              type: "json",
              value: "a-secret-long-enough-to-sign-and-encrypt-cookies",
            },
          },
          exports: {
            AlephaActorDurableObject: {
              type: "durable-object",
              storage: "sqlite",
            },
          },
        },
        setup: async (mf) => {
          const db = await mf.getD1Database("DB");
          for (const statement of statements) {
            await db.prepare(statement).run();
          }
        },
        source: `
import { Alepha, run } from "alepha";
import { ActorHostRuntime } from "alepha/actor";
export { AlephaActorDurableObject } from "alepha/actor";
import { $realm, RealmProvider } from "alepha/api/users";
import { AlephaSecurity, SecurityProvider } from "alepha/security";

class HeaderSecurityProvider extends SecurityProvider {
 async resolveUserFromServerRequest(request) {
  const id = request.headers["x-user"];
  return id ? { id, realm: "users", roles: ["user"] } : undefined;
 }
}
class App { realm = $realm({ settings: { passkeys: "optional" } }); }
const app = run(Alepha.create({ env: { DATABASE_URL: "d1://DB" } })
 .with({ provide: SecurityProvider, use: HeaderSecurityProvider })
 .with(AlephaSecurity)
 .with(App));
let started = false;
const boot = async (env) => {
 if (started) return app;
 started = true;
 app.set("cloudflare.env", env);
 await app.start();
 return app;
};
export default { async fetch(request, env) {
 ActorHostRuntime.resolve(env);
 const app = await boot(env);
 if (new URL(request.url).pathname === "/seed") {
  const user = await app.inject(RealmProvider).userRepository().create({ email: "ada@example.test" });
  return Response.json({ id: user.id });
 }
 const ctx = { req: request };
 await app.events.emit("web:request:before", ctx);
 return ctx.res ?? new Response("no response", { status: 500 });
} };
`,
      },
      async (dispatch) => {
        const { id } = (await (
          await dispatch({}, { path: "/seed" })
        ).json()) as { id: string };
        const headers = { "content-type": "application/json", "x-user": id };

        const options = await dispatch(
          {},
          { path: "/api/users/me/passkeys/options", headers },
        );
        const cookie = options.headers
          .getSetCookie()
          .map((it) => it.split(";")[0])
          .join("; ");
        const credential = await device.create((await options.json()) as never);

        const withoutCookie = await dispatch(
          { credential },
          { path: "/api/users/me/passkeys", headers },
        );
        const added = await dispatch(
          { credential, name: "Worker" },
          { path: "/api/users/me/passkeys", headers: { ...headers, cookie } },
        );
        const list = await dispatch(undefined, {
          method: "GET",
          path: "/api/users/me/passkeys",
          headers,
        });
        return {
          cookie: cookie.includes("passkeyChallenge="),
          withoutCookie: ((await withoutCookie.json()) as { name: string })
            .name,
          added: added.status,
          list: await list.json(),
        };
      },
    );

    expect(result.cookie).toBe(true);
    expect(result.withoutCookie).toBe("PASSKEY_CHALLENGE");
    expect(result.added).toBe(200);
    expect(result.list).toMatchObject({
      proof: "passkey",
      items: [{ name: "Worker", usable: true }],
    });
  }, 120_000);
});
