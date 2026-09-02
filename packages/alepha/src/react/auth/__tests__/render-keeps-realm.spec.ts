import { randomUUID } from "node:crypto";

import { Alepha } from "alepha";
import {
  $issuer,
  $secure,
  AlephaSecurity,
  currentUserAtom,
} from "alepha/security";
import { $action, AlephaServer } from "alepha/server";
import { describe, it } from "vitest";

import { AlephaReactAuth } from "../index.ts";

/**
 * `react:server:render:begin` used to strip `token` and `realm` off the
 * request's user and store THAT copy in `currentUserAtom`:
 *
 * ```ts
 * const { token, realm, ...user } = request.user;
 * this.alepha.store.set(currentUserAtom, user);
 * state.user = user;
 * ```
 *
 * The stripping is right and the destination was wrong. `currentUserAtom` is
 * the FIRST place `$secure` looks for the caller on the server, so the
 * stripped copy became the authorization context for the rest of the render:
 * every check after the render began resolved role names against `realms[0]`
 * instead of the caller's realm, and refused the page with
 * `Role '<name>' not found` - naming a role the caller does hold, in a realm
 * they do not belong to.
 *
 * Invisible with a single realm, where the fallback to `realms[0]` is always
 * the right answer. With a second realm it disables that realm completely.
 */
describe("server rendering keeps the caller's realm in the auth context", () => {
  class App {
    // Declared first, so it is `realms[0]` and therefore what a realm-less
    // lookup falls back to. The role names deliberately COLLIDE: that is the
    // production shape, and it is what makes the bug a wrong answer rather
    // than a crash.
    citizens = $issuer({
      secret: "secret-citizens",
      roles: [{ name: "pending", permissions: [{ name: "citizen:apply" }] }],
    });

    staff = $issuer({
      secret: "secret-staff",
      roles: [{ name: "pending", permissions: [{ name: "staff:handle" }] }],
    });

    handle = $action({
      use: [$secure({ permissions: ["staff:handle"] })],
      handler: () => "handled",
    });
  }

  const boot = async () => {
    const alepha = Alepha.create()
      .with(AlephaServer)
      .with(AlephaSecurity)
      .with(AlephaReactAuth);
    const app = alepha.inject(App);
    await alepha.start();
    return { alepha, app };
  };

  const requestUser = () => ({
    id: randomUUID(),
    roles: ["pending"],
    realm: "staff",
    token: "opaque-token",
  });

  const beginRender = async (alepha: Alepha, user: object) => {
    const state: Record<string, any> = {};
    await alepha.events.emit("react:server:render:begin", {
      request: { user } as any,
      state,
    } as any);
    return state;
  };

  it("stores the caller's realm in currentUserAtom", async ({ expect }) => {
    const { alepha } = await boot();
    const user = requestUser();

    await beginRender(alepha, user);

    const stored = alepha.store.get(currentUserAtom) as any;
    expect(stored?.id).toBe(user.id);
    expect(stored?.realm).toBe("staff");
    // `token` is absent whatever is handed to the atom: `userAccountInfoSchema`
    // does not declare it, so the store drops it. Storing the request's user
    // whole therefore publishes no credential - the stripping that matters is
    // the one on `state.user`, which does cross to the browser.
    expect(stored).not.toHaveProperty("token");
  });

  it("still sends neither token nor realm to the client", async ({
    expect,
  }) => {
    const { alepha } = await boot();
    const user = requestUser();

    const state = await beginRender(alepha, user);

    // The half the stripping was for, and the half that must not regress.
    expect(state.user).toBeDefined();
    expect(state.user).not.toHaveProperty("token");
    expect(state.user).not.toHaveProperty("realm");
    expect(state.user.id).toBe(user.id);
  });

  it("authorizes a second-realm caller after the render began", async ({
    expect,
  }) => {
    const { alepha, app } = await boot();

    await beginRender(alepha, requestUser());

    // Resolved against `citizens` before the fix, whose `pending` role does
    // not carry `staff:handle`.
    await expect(app.handle.run()).resolves.toBe("handled");
  });

  it("still refuses a permission the caller's own realm does not grant", async ({
    expect,
  }) => {
    const { alepha, app } = await boot();

    // A citizen, resolved as a citizen: `staff:handle` is not theirs, and the
    // refusal has to survive the fix rather than be traded for it.
    await beginRender(alepha, { ...requestUser(), realm: "citizens" });

    await expect(app.handle.run()).rejects.toThrow(/staff:handle/);
  });
});
