import { Alepha } from "alepha";
import { AlephaOrmPostgres } from "alepha/orm/postgres";
import { AlephaSecurity, CryptoProvider } from "alepha/security";
import { describe, it } from "vitest";

import {
  $realm,
  RealmProvider,
  RegistrationService,
  SessionService,
  UserService,
} from "../index.ts";

describe("alepha/api/users - $realm with parameters", () => {
  it("should create settingsParameter when features.parameters is true", async ({
    expect,
  }) => {
    const alepha = Alepha.create();
    alepha.with(AlephaOrmPostgres);
    alepha.with(AlephaSecurity);
    alepha.with(() => {
      return { realm: $realm({ features: { parameters: true } }) };
    });
    await alepha.start();

    const realmProvider = alepha.inject(RealmProvider);
    const realm = realmProvider.getRealm();

    expect(realm.settingsParameter).toBeDefined();
    expect(realm.settingsParameter!.name).toBe("api.realms.settings.default");
  });

  it("should not create settingsParameter when features.parameters is false", async ({
    expect,
  }) => {
    const alepha = Alepha.create();
    alepha.with(AlephaOrmPostgres);
    alepha.with(AlephaSecurity);
    alepha.with(() => {
      return { realm: $realm() };
    });
    await alepha.start();

    const realmProvider = alepha.inject(RealmProvider);
    const realm = realmProvider.getRealm();

    expect(realm.settingsParameter).toBeUndefined();
  });

  it("should return dynamic settings via getSettings() after parameter set", async ({
    expect,
  }) => {
    const alepha = Alepha.create();
    alepha.with(AlephaOrmPostgres);
    alepha.with(AlephaSecurity);
    alepha.with(() => {
      return { realm: $realm({ features: { parameters: true } }) };
    });
    await alepha.start();

    const realmProvider = alepha.inject(RealmProvider);
    const realm = realmProvider.getRealm();

    // Default settings
    const settingsA = await realm.getSettings();
    expect(settingsA.registrationAllowed).toBe(true);

    // Update via parameter
    await realm.settingsParameter!.set({
      ...settingsA,
      registrationAllowed: false,
    });

    // New settings reflected
    const settingsB = await realm.getSettings();
    expect(settingsB.registrationAllowed).toBe(false);
  });

  it("should use build-time settings as parameter default", async ({
    expect,
  }) => {
    const alepha = Alepha.create();
    alepha.with(AlephaOrmPostgres);
    alepha.with(AlephaSecurity);
    alepha.with(() => {
      return {
        realm: $realm({
          features: { parameters: true },
          settings: { registrationAllowed: false },
        }),
      };
    });
    await alepha.start();

    const realmProvider = alepha.inject(RealmProvider);
    const realm = realmProvider.getRealm();

    // Default should be the build-time config, not the atom default
    const settings = await realm.getSettings();
    expect(settings.registrationAllowed).toBe(false);
  });

  it("should enforce dynamically changed registration setting", async ({
    expect,
  }) => {
    const alepha = Alepha.create();
    alepha.with(AlephaOrmPostgres);
    alepha.with(AlephaSecurity);
    alepha.with(() => {
      return { realm: $realm({ features: { parameters: true } }) };
    });
    await alepha.start();

    const realmProvider = alepha.inject(RealmProvider);
    const registrationService = alepha.inject(RegistrationService);
    const realm = realmProvider.getRealm();

    // Registration works with defaults
    const intent = await registrationService.createRegistrationIntent({
      email: "test@example.com",
      password: "SecurePassword123!",
    });
    expect(intent.intentId).toBeDefined();

    // Disable registration via parameter
    const currentSettings = await realm.getSettings();
    await realm.settingsParameter!.set({
      ...currentSettings,
      registrationAllowed: false,
    });

    // Registration now rejected
    await expect(
      registrationService.createRegistrationIntent({
        email: "test2@example.com",
        password: "SecurePassword123!",
      }),
    ).rejects.toThrow("Registration is not allowed");
  });

  it("should enforce dynamically changed adminEmails setting", async ({
    expect,
  }) => {
    const alepha = Alepha.create();
    alepha.with(AlephaOrmPostgres);
    alepha.with(AlephaSecurity);
    alepha.with(() => {
      return { realm: $realm({ features: { parameters: true } }) };
    });
    await alepha.start();

    const realmProvider = alepha.inject(RealmProvider);
    const sessionService = alepha.inject(SessionService);
    const realm = realmProvider.getRealm();

    // Create a user
    const userService = alepha.inject(UserService);
    const cryptoProvider = alepha.inject(CryptoProvider);
    const user = await userService.users().create({
      email: "admin-promo@example.com",
      roles: ["user"],
    });
    await sessionService.identities().create({
      userId: user.id,
      provider: "credentials",
      password: await cryptoProvider.hashPassword("SecurePassword123!"),
    });

    // Login — user should NOT be admin
    const loggedIn = await sessionService.login(
      "credentials",
      "admin-promo@example.com",
      "SecurePassword123!",
    );
    expect(loggedIn.roles).not.toContain("admin");

    // Add email to adminEmails via parameter
    const currentSettings = await realm.getSettings();
    await realm.settingsParameter!.set({
      ...currentSettings,
      adminEmails: ["admin-promo@example.com"],
    });

    // Login again — user should now be promoted to admin
    const loggedIn2 = await sessionService.login(
      "credentials",
      "admin-promo@example.com",
      "SecurePassword123!",
    );
    expect(loggedIn2.roles).toContain("admin");
  });
});
