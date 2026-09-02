import { Alepha } from "alepha";
import { AlephaOrmPostgres } from "alepha/orm/postgres";
import { AlephaSecurity } from "alepha/security";
import { LinkProvider } from "alepha/server/links";
import { describe, it } from "vitest";

import { $realm } from "../index.ts";

/**
 * **Regression guard: `features.avatars` has to gate the endpoints, not just
 * the storage behind them.**
 *
 * `updateMyAvatar` / `deleteMyAvatar` used to live on `MyProfileController`,
 * which is always registered and injected `UserStorage` directly — so the
 * storage the flag was supposed to control got pulled in transitively and both
 * routes answered on every realm, including the default one where `avatars` is
 * `false`. The flag switched on a service nothing could observe. Nothing could
 * have gone red for it either: no test asserted on the *absence* of a route,
 * and `@alepha/ui`'s account page rendered its avatar picker unconditionally,
 * so the UI agreed with the wrong answer.
 *
 * These read the link registry rather than call the actions, because the point
 * is registration: an unregistered action is absent from `/api/_links`, which
 * is also what makes the UI hide itself with no second flag to keep in sync.
 */
const registeredActions = async (features?: { avatars: boolean }) => {
  const alepha = Alepha.create({ env: { LOG_LEVEL: "error" } });
  alepha.with(AlephaOrmPostgres);
  alepha.with(AlephaSecurity);
  alepha.with(() => ({ realm: $realm(features ? { features } : undefined) }));
  await alepha.start();

  return alepha.inject(LinkProvider).links.map((link) => link.name);
};

describe("alepha/api/users - MyAvatarController", () => {
  it("should not register the avatar endpoints on a realm without the flag", async ({
    expect,
  }) => {
    const actions = await registeredActions();

    expect(actions).not.toContain("updateMyAvatar");
    expect(actions).not.toContain("deleteMyAvatar");
    // The rest of the profile is unaffected — this is the avatar's own switch,
    // not a switch on the account area.
    expect(actions).toContain("updateMyProfile");
    expect(actions).toContain("getMyProfile");
  });

  it("should register them when the realm enables avatars", async ({
    expect,
  }) => {
    const actions = await registeredActions({ avatars: true });

    expect(actions).toContain("updateMyAvatar");
    expect(actions).toContain("deleteMyAvatar");
  });
});

/**
 * The operator-side pair (#1669), on the same flag and for the same reason: a
 * realm that switched avatars off must not grow admin endpoints for them.
 *
 * Kept off `AdminUserController` deliberately. That controller is always
 * registered, so putting these two actions on it would pull `UserStorage` in
 * transitively and leave the routes answering on every realm - which is
 * verbatim the bug the self-service split above was made to fix.
 */
describe("alepha/api/users - AdminAvatarController", () => {
  it("should not register the admin avatar endpoints without the flag", async ({
    expect,
  }) => {
    const actions = await registeredActions();

    expect(actions).not.toContain("updateUserAvatar");
    expect(actions).not.toContain("deleteUserAvatar");
    // The rest of the admin surface is unaffected: this is the avatar's own
    // switch, not a switch on the admin area.
    expect(actions).toContain("updateUser");
    expect(actions).toContain("getUser");
  });

  it("should register them when the realm enables avatars", async ({
    expect,
  }) => {
    const actions = await registeredActions({ avatars: true });

    expect(actions).toContain("updateUserAvatar");
    expect(actions).toContain("deleteUserAvatar");
  });

  it("should gate them on their own permission, not on admin:user:update", async ({
    expect,
  }) => {
    // Reaching into somebody's profile picture is a different capability from
    // editing their roles or their email, and an operator trusted with one is
    // not automatically trusted with the other.
    const alepha = Alepha.create({ env: { LOG_LEVEL: "error" } });
    alepha.with(AlephaOrmPostgres);
    alepha.with(AlephaSecurity);
    alepha.with(() => ({ realm: $realm({ features: { avatars: true } }) }));
    await alepha.start();

    const links = alepha.inject(LinkProvider).links;
    const update = links.find((link) => link.name === "updateUserAvatar");
    const remove = links.find((link) => link.name === "deleteUserAvatar");

    for (const link of [update, remove]) {
      const secured = link?.secured;
      expect(
        typeof secured === "object" ? secured.permissions : undefined,
      ).toEqual(["admin:user:avatar"]);
    }
  });
});
