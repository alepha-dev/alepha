import { Alepha } from "alepha";
import { AlephaOrmPostgres } from "alepha/orm/postgres";
import { AlephaSecurity } from "alepha/security";
import { BadRequestError } from "alepha/server";
import { describe, expect, it } from "vitest";

import {
  AlephaApiUsers,
  RealmProvider,
  SessionService,
  UserService,
} from "../index.ts";

const suffix = () => Math.random().toString(36).slice(2, 8);

/**
 * A password given to `createUser`, checked before anything is written.
 *
 * Creating an account with a credential used to take two calls, `createUser`
 * then `setPassword`, and they are not atomic: when the realm's policy
 * refused the password in the second, the account already existed with no
 * credential. A bootstrap written as "create if missing, skip if it exists"
 * then skipped that passwordless row forever, and correcting the password in
 * its configuration changed nothing. Found downstream in Mikanda.
 */
describe("createUser with a password", () => {
  const boot = async () => {
    const alepha = Alepha.create({ env: { LOG_LEVEL: "error" } });
    alepha.with(AlephaOrmPostgres);
    alepha.with(AlephaSecurity);
    alepha.with(AlephaApiUsers);
    await alepha.start();
    return {
      userService: alepha.inject(UserService),
      sessions: alepha.inject(SessionService),
      users: alepha.inject(RealmProvider).userRepository(),
    };
  };

  it("refuses a password the realm policy refuses, and writes no user", async () => {
    const { userService, users } = await boot();
    const email = `refused-${suffix()}@example.com`;

    // The default policy wants upper case, lower case and a digit.
    await expect(
      userService.createUser({ email }, "users", { password: "alllowercase" }),
    ).rejects.toThrow(BadRequestError);

    const left = await users.findMany({ where: { email: { eq: email } } });
    expect(left, "an account was left behind with no password").toHaveLength(0);
  });

  it("creates the user with a password that signs in", async () => {
    const { userService, sessions } = await boot();
    const email = `accepted-${suffix()}@example.com`;

    const created = await userService.createUser({ email }, "users", {
      password: "Valid1Pass!",
    });

    const signedIn = await sessions.login(
      "credentials",
      email,
      "Valid1Pass!",
      "users",
    );
    expect(signedIn.id).toBe(created.id);
  });

  it("still creates a user with no credential when no password is given", async () => {
    const { userService, sessions } = await boot();
    const email = `bare-${suffix()}@example.com`;

    const created = await userService.createUser({ email }, "users");

    expect(created.email).toBe(email);
    await expect(
      sessions.login("credentials", email, "Valid1Pass!", "users"),
    ).rejects.toThrow(/credentials|password|invalid/i);
  });
});
