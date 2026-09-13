import { Alepha } from "alepha";
import { AlephaApiUsers, UserService } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { AlephaFake } from "alepha/fake";
import { AlephaOrm } from "alepha/orm";
import { AlephaSecurity, type UserAccountToken } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { describe, it } from "vitest";

import { LoreApi } from "../index.ts";
import { NotificationPreferenceController } from "./NotificationPreferenceController.ts";

/**
 * Pinned like every other lore spec: the ROOT vitest config sets a Postgres
 * `DATABASE_URL`, which this app's SQLite provider rejects.
 */
const setup = async () => {
  const alepha = Alepha.create({
    env: { LOG_LEVEL: "error", SERVER_PORT: 0, DATABASE_URL: ":memory:" },
  });
  alepha.with(AlephaOrm);
  alepha.with(AlephaServer);
  alepha.with(AlephaSecurity);
  alepha.with(AlephaEmail);
  alepha.with(AlephaApiUsers);
  alepha.with(AlephaFake);
  alepha.with(LoreApi);

  const controller = alepha.inject(NotificationPreferenceController);
  const users = alepha.inject(UserService);
  await alepha.start();

  const account = await users.createUser({ username: "prefs" });
  const session: UserAccountToken = { id: account.id, roles: ["user"] };

  return { controller, session };
};

/**
 * Every non-GET route under `/users/me` refuses a machine credential (D10),
 * Lore's own included: an API key may read its owner's preferences, not
 * change them.
 */
describe("NotificationPreferenceController under an API key", () => {
  it("refuses the update to a key and accepts it from a session", async ({
    expect,
  }) => {
    const { controller, session } = await setup();
    const key: UserAccountToken = {
      ...session,
      credential: { type: "api-key", id: "key-1" },
    };

    await expect(
      controller.updateMyNotificationPreferences.run(
        { body: { emailEnabled: false } },
        { user: key },
      ),
    ).rejects.toThrow("requires a signed-in session");

    const read = await controller.getMyNotificationPreferences.run(
      {},
      { user: key },
    );
    expect(read.emailEnabled).toBe(true);

    const updated = await controller.updateMyNotificationPreferences.run(
      { body: { emailEnabled: false } },
      { user: session },
    );
    expect(updated.emailEnabled).toBe(false);
  });
});
