import { Alepha } from "alepha";
import { AlephaOrmPostgres } from "alepha/orm/postgres";
import { AlephaSecurity, type UserAccountToken } from "alepha/security";
import { describe, expect, it } from "vitest";

import { AdminUserController, AlephaApiUsers } from "../index.ts";

const asAdmin: { user: UserAccountToken } = {
  user: {
    id: "00000000-0000-0000-0000-000000000001",
    name: "Test Admin",
    roles: ["admin"],
  },
};

const suffix = () => Math.random().toString(36).slice(2, 8);

/**
 * The users API names its realm `userRealmName`, and refuses `realm`.
 *
 * Both natural spellings used to be accepted and ignored: a `realm` field in
 * a create body was stripped, so the account landed in the default realm, and
 * a `realm=` query was dropped, so a listing answered with the caller's realm.
 * That is how two accounts came to exist in a downstream production (Mikanda)
 * in a realm whose door does not open the back office. A refusal naming the
 * parameter is the whole fix.
 */
describe("the users API and a realm it would drop", () => {
  const setup = async () => {
    const alepha = Alepha.create({ env: { LOG_LEVEL: "error" } });
    alepha.with(AlephaOrmPostgres);
    alepha.with(AlephaApiUsers);
    alepha.with(AlephaSecurity);
    await alepha.start();
    return alepha.inject(AdminUserController);
  };

  it("refuses a realm field in a create body, naming userRealmName", async () => {
    const controller = await setup();

    await expect(
      controller.createUser(
        {
          body: { email: `r-${suffix()}@example.com`, realm: "staff" } as never,
        },
        asAdmin,
      ),
    ).rejects.toThrow(/userRealmName/);
  });

  it("refuses a realm field in an update body, naming userRealmName", async () => {
    const controller = await setup();
    const created = await controller.createUser(
      { body: { email: `u-${suffix()}@example.com` } },
      asAdmin,
    );

    await expect(
      controller.updateUser(
        { params: { id: created.id }, body: { realm: "staff" } as never },
        asAdmin,
      ),
    ).rejects.toThrow(/userRealmName/);
  });

  it("refuses a realm= query, naming userRealmName", async () => {
    const controller = await setup();

    await expect(
      controller.findUsers({ query: { realm: "staff" } as never }, asAdmin),
    ).rejects.toThrow(/userRealmName/);
  });

  it("keeps userRealmName working exactly as before", async () => {
    const controller = await setup();
    const email = `k-${suffix()}@example.com`;
    await controller.createUser(
      { query: { userRealmName: "users" }, body: { email } },
      asAdmin,
    );

    const page = await controller.findUsers(
      { query: { userRealmName: "users", email } },
      asAdmin,
    );

    expect(page.content.map((user) => user.email)).toContain(email);
  });
});
