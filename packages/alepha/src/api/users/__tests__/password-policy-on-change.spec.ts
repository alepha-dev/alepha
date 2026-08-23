import { Alepha } from "alepha";
import { AlephaOrmPostgres } from "alepha/orm/postgres";
import { AlephaSecurity } from "alepha/security";
import { BadRequestError } from "alepha/server";
import { describe, expect, it } from "vitest";

import {
  AlephaApiUsers,
  MyPasswordController,
  RealmProvider,
  UserService,
} from "../index.ts";

const suffix = () => Math.random().toString(36).slice(2, 8);

describe("password policy on change", () => {
  it("applies the whole realm policy, not only minLength", async () => {
    const alepha = Alepha.create({ env: { LOG_LEVEL: "error" } });
    alepha.with(AlephaOrmPostgres);
    alepha.with(AlephaSecurity);
    alepha.with(AlephaApiUsers);
    await alepha.start();

    const tag = suffix();
    const users = alepha.inject(RealmProvider).userRepository();
    const user = await users.create({
      username: `pwd${tag}`,
      email: `pwd-${tag}@example.com`,
    });
    const userService = alepha.inject(UserService);
    await userService.setPassword(user.id, "Valid1Pass!", "default");

    const controller = alepha.inject(MyPasswordController);
    const session = {
      user: { id: user.id, realm: "default", sessionId: "s" } as never,
    };

    // The default policy requires upper case, lower case and digits;
    // `setPassword` used to check the length alone.
    await expect(
      controller.changeMyPassword(
        {
          body: { currentPassword: "Valid1Pass!", newPassword: "alllowercase" },
        } as never,
        session,
      ),
    ).rejects.toThrow(BadRequestError);

    const ok = await controller.changeMyPassword(
      {
        body: { currentPassword: "Valid1Pass!", newPassword: "Another1Pass!" },
      } as never,
      session,
    );
    expect(ok.otherSessionsRevoked).toBe(0);
  });
});
