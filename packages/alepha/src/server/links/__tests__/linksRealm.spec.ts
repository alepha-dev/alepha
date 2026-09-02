import { randomUUID } from "node:crypto";

import { Alepha, z } from "alepha";
import { $issuer, $secure, AlephaSecurity } from "alepha/security";
import { $action } from "alepha/server";
import { describe, it } from "vitest";

import { ServerLinksProvider } from "../index.ts";

/**
 * `isLinkAccessible` resolved a link's permissions with
 * `checkPermission(perm, ...user.roles)`, which takes the realm only from a
 * permission OBJECT. Given none, `rolesForRealm(undefined)` falls back to
 * `realms[0]`, so a second-realm user's role names were looked up among the
 * FIRST realm's roles and `checkRoles` threw on the first one it could not
 * find.
 *
 * `GET /api/_links` runs on every page load, so an authenticated user outside
 * the first declared realm rendered nothing at all: a 500, naming a role they
 * do hold.
 *
 * `$secure` - the gate this registry only mirrors - already called
 * `checkPermissionInRealm(user.realm, …)`, so the two disagreed about the
 * same question.
 */
describe("the link registry resolves permissions in the caller's realm", () => {
  class App {
    // First, so it is what a realm-less lookup falls back to. `citizen` and
    // `handler` are disjoint, which is what turns the fallback into a throw;
    // `agent` is shared, which is what turns it into a wrong answer. Both
    // shapes occur, and only the second one is silent.
    citizens = $issuer({
      secret: "secret-citizens",
      roles: [
        { name: "citizen", permissions: [{ name: "citizen:apply" }] },
        // The same NAME in both realms, granting different things. That is
        // the production shape, and the case where the fallback gives a wrong
        // answer rather than a throw.
        { name: "agent", permissions: [{ name: "citizen:apply" }] },
      ],
    });

    staff = $issuer({
      secret: "secret-staff",
      roles: [
        { name: "pending", permissions: [] },
        { name: "handler", permissions: [{ name: "staff:handle" }] },
        { name: "agent", permissions: [{ name: "staff:handle" }] },
      ],
    });

    handle = $action({
      use: [$secure({ permissions: ["staff:handle"] })],
      schema: { response: z.text() },
      handler: () => "HANDLED",
    });

    apply = $action({
      use: [$secure({ permissions: ["citizen:apply"] })],
      schema: { response: z.text() },
      handler: () => "APPLIED",
    });
  }

  const boot = async () => {
    const alepha = Alepha.create()
      .with(App)
      .with(ServerLinksProvider)
      .with(AlephaSecurity);
    await alepha.start();
    return alepha.inject(ServerLinksProvider);
  };

  it("answers for a caller in the second realm instead of throwing", async ({
    expect,
  }) => {
    const links = await boot();

    // `Role 'handler' not found`, thrown from `citizens`, before the fix.
    const registry = await links.getUserApiLinks({
      user: {
        id: randomUUID(),
        roles: ["pending", "handler"],
        realm: "staff",
      },
    });

    expect(registry.actions.handle).toBeDefined();
    // And the other realm's action is not theirs.
    expect(registry.actions.apply).toBeUndefined();
  });

  it("still answers for a caller in the first realm", async ({ expect }) => {
    const links = await boot();

    const registry = await links.getUserApiLinks({
      user: { id: randomUUID(), roles: ["citizen"], realm: "citizens" },
    });

    expect(registry.actions.apply).toBeDefined();
    expect(registry.actions.handle).toBeUndefined();
  });

  it("reads a shared role name in the caller's realm, not the first one", async ({
    expect,
  }) => {
    const links = await boot();

    // `agent` exists in both realms and grants a different permission in each,
    // so the fallback answers without throwing - and answers the other realm's
    // question. Before the fix this registry carried `apply` and not `handle`,
    // exactly inverted.
    const registry = await links.getUserApiLinks({
      user: { id: randomUUID(), roles: ["agent"], realm: "staff" },
    });

    expect(registry.actions.handle).toBeDefined();
    expect(registry.actions.apply).toBeUndefined();
  });

  /**
   * ⚠️ Separate, and NOT fixed here: a role name that exists in no realm at
   * all still throws out of the registry rather than resolving to "no links".
   * A stale token surviving a role rename is enough to produce one, and this
   * endpoint runs on every page load, so the blast radius is the same 500 the
   * realm fault had. `checkRoles` throwing is `$secure`'s behaviour too, so
   * changing it is a decision about both, not a patch here.
   */
  it("still throws on a role name no realm declares", async ({ expect }) => {
    const links = await boot();

    await expect(
      links.getUserApiLinks({
        user: { id: randomUUID(), roles: ["ghost"], realm: "staff" },
      }),
    ).rejects.toThrow(/Role 'ghost' not found/);
  });
});
