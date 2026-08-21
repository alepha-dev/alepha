import { Alepha } from "alepha";
import { AlephaOrmPostgres } from "alepha/orm/postgres";
import { AlephaSecurity } from "alepha/security";
import { describe, it } from "vitest";

import { AlephaApiUsers, RealmProvider } from "../index.ts";

describe("alepha/api/users - RealmProvider", () => {
  it("should return settings via getSettings()", async ({ expect }) => {
    const alepha = Alepha.create();
    alepha.with(AlephaOrmPostgres);
    alepha.with(AlephaSecurity);
    alepha.with(AlephaApiUsers);
    await alepha.start();

    const realmProvider = alepha.inject(RealmProvider);
    const realm = realmProvider.getRealm();

    const settings = await realm.getSettings();
    expect(settings.registrationAllowed).toBe(true);
    expect(settings.email).toBe("required");
    expect(settings.loginRateLimit.ipMaxAttempts).toBe(15);
  });

  it("should reject realm names containing dots", async ({ expect }) => {
    const alepha = Alepha.create();
    alepha.with(AlephaOrmPostgres);
    alepha.with(AlephaSecurity);
    alepha.with(AlephaApiUsers);
    await alepha.start();

    const realmProvider = alepha.inject(RealmProvider);
    expect(() => realmProvider.register("my.realm")).toThrow(
      "must not contain dots",
    );
  });

  it("should return custom settings when configured", async ({ expect }) => {
    const alepha = Alepha.create();
    alepha.with(AlephaOrmPostgres);
    alepha.with(AlephaSecurity);
    alepha.with(AlephaApiUsers);
    await alepha.start();

    const realmProvider = alepha.inject(RealmProvider);
    realmProvider.register("custom", {
      settings: { registrationAllowed: false } as never,
    });

    const realm = realmProvider.getRealm("custom");
    const settings = await realm.getSettings();
    expect(settings.registrationAllowed).toBe(false);
  });
});
