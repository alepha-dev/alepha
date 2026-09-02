import { Alepha } from "alepha";
import { AdminParameterController } from "alepha/api/parameters";
import {
  AlephaApiUsers,
  RealmProvider,
  RegistrationService,
} from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { AlephaOrm } from "alepha/orm";
import type { UserAccountToken } from "alepha/security";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { describe, it } from "vitest";

import { LoreApi } from "../index.ts";

/**
 * The realm switch, from the outside: does Lore's own realm expose a
 * `settingsParameter` an owner can edit, and does the compiled default land
 * open on the deployed instance and closed on a self-hosted image?
 *
 * The generic half ("a parameter flip gates `RegistrationService`") is
 * already proven in `packages/alepha/src/api/users/__tests__/$realm.spec.ts`
 * and is not repeated here. What is Lore-specific, and what silently closing
 * production would look like, is the default rule below.
 *
 * Pinned `DATABASE_URL` like every other lore spec: the ROOT vitest config
 * points it at Postgres, which this app's SQLite provider rejects.
 */
const boot = async (env: Record<string, string> = {}) => {
  const alepha = Alepha.create({
    env: { LOG_LEVEL: "error", DATABASE_URL: ":memory:", ...env },
  });

  alepha.with(AlephaOrm);
  alepha.with(AlephaServer);
  alepha.with(AlephaSecurity);
  alepha.with(AlephaEmail);
  alepha.with(AlephaApiUsers);
  alepha.with(LoreApi);

  await alepha.start();

  return { alepha, realm: alepha.inject(RealmProvider).getRealm() };
};

describe("AppSecurityProvider", () => {
  it("mints a settings parameter the admin Parameters page can edit", async ({
    expect,
  }) => {
    const { alepha, realm } = await boot();

    expect(realm.settingsParameter).toBeDefined();
    expect(realm.settingsParameter!.name).toBe("api.realms.default");

    await alepha.stop();
  });

  it("defaults registration OPEN, so turning the parameter on never closes production", async ({
    expect,
  }) => {
    const { alepha, realm } = await boot();

    const settings = await realm.getSettings();
    expect(settings.registrationAllowed).toBe(true);

    await alepha.stop();
  });

  it("defaults registration CLOSED when REGISTRATION_ALLOWED is false", async ({
    expect,
  }) => {
    const { alepha, realm } = await boot({ REGISTRATION_ALLOWED: "false" });

    const settings = await realm.getSettings();
    expect(settings.registrationAllowed).toBe(false);

    await alepha.stop();
  });

  it("lets an owner flip the switch at runtime, both ways", async ({
    expect,
  }) => {
    const { alepha, realm } = await boot();

    const open = await realm.getSettings();
    await realm.settingsParameter!.set({
      ...open,
      registrationAllowed: false,
    });
    expect((await realm.getSettings()).registrationAllowed).toBe(false);

    await realm.settingsParameter!.set({ ...open, registrationAllowed: true });
    expect((await realm.getSettings()).registrationAllowed).toBe(true);

    await alepha.stop();
  });

  /**
   * The point of the switch: not that a field changed, but that Lore's own
   * registration path refuses afterwards. Asserted here rather than left to
   * the framework's `$realm.spec.ts` because it is Lore's realm, Lore's
   * settings and Lore's container that have to agree.
   */
  it("a flip actually closes Lore's own registration path", async ({
    expect,
  }) => {
    const { alepha, realm } = await boot();
    const registration = alepha.inject(RegistrationService);

    const intent = await registration.createRegistrationIntent({
      email: "before@example.com",
      password: "SecurePassword123!",
    });
    expect(intent.intentId).toBeDefined();

    // `bootstrapFirstUser` keeps a closed realm reachable while it holds NO
    // account, so the flip only bites once one exists. Seeded directly:
    // Lore requires email verification, and the code round trip is not what
    // this test is about.
    await realm.repositories.users.create({
      realm: realm.name,
      email: "owner@example.com",
      roles: ["admin"],
    });

    const open = await realm.getSettings();
    await realm.settingsParameter!.set({
      ...open,
      registrationAllowed: false,
    });

    await expect(
      registration.createRegistrationIntent({
        email: "after@example.com",
        password: "SecurePassword123!",
      }),
    ).rejects.toThrowError("Registration is not allowed");

    await alepha.stop();
  });

  /**
   * Everything that completes by sending a code is off until there is
   * somewhere to send it. A fresh container with no SMTP would otherwise
   * register an account and park the operator on a "check your inbox"
   * screen, for a mail written to a file on disk.
   */
  it("turns the email-gated settings off when EMAIL_HOST is unset", async ({
    expect,
  }) => {
    const { alepha, realm } = await boot();

    const settings = await realm.getSettings();
    expect(settings.verifyEmailRequired).toBe(false);
    expect(settings.resetPasswordAllowed).toBe(false);

    await alepha.stop();
  });

  it("turns them on when EMAIL_HOST is set", async ({ expect }) => {
    const { alepha, realm } = await boot({ EMAIL_HOST: "smtp.example.com" });

    const settings = await realm.getSettings();
    expect(settings.verifyEmailRequired).toBe(true);
    expect(settings.resetPasswordAllowed).toBe(true);

    await alepha.stop();
  });

  /**
   * The self-hosted bootstrap, from Lore's side. The framework's own rules
   * are proven in `bootstrapFirstUser.spec.ts`; what belongs here is that
   * Lore's realm actually asks for the behaviour, and that an operator who
   * closes a FRESH instance can still create the account that could reopen
   * it.
   */
  it("keeps a closed instance reachable until its first account exists", async ({
    expect,
  }) => {
    const { alepha, realm } = await boot({ REGISTRATION_ALLOWED: "false" });
    const registration = alepha.inject(RegistrationService);

    expect(realm.bootstrapFirstUser).toBe(true);
    expect((await realm.getSettings()).registrationAllowed).toBe(false);

    const intent = await registration.createRegistrationIntent({
      email: "owner@example.com",
      password: "SecurePassword123!",
    });
    expect(intent.intentId).toBeDefined();

    await alepha.stop();
  });

  /**
   * The reason `bootstrapFirstUser` is an expression rather than `true`:
   * the framework refuses it on serverless, so an unconditional `true` here
   * would stop lore.alepha.dev from booting.
   */
  it("does not ask for the bootstrap on Workers", async ({ expect }) => {
    const { alepha, realm } = await boot({ ALEPHA_SERVERLESS: "true" });

    expect(realm.bootstrapFirstUser).toBe(false);

    await alepha.stop();
  });

  /**
   * The admin Parameters page reads through this controller, so reaching the
   * realm's row through it is what "the page shows the switch" means. It is
   * also where the frozen-default trap starts: this call is what seeds v1
   * from the compiled defaults, after which editing `AppSecurityProvider`
   * stops changing anything on a running instance.
   */
  it("exposes the realm settings on the admin Parameters API, seeding v1", async ({
    expect,
  }) => {
    const { alepha } = await boot();
    const controller = alepha.inject(AdminParameterController);
    const admin: UserAccountToken = {
      id: crypto.randomUUID(),
      roles: ["admin"],
    };

    const result = await controller.getCurrent.run(
      { params: { name: "api.realms.default" } },
      { user: admin },
    );

    expect(
      (result.defaultValue as { registrationAllowed: boolean })
        .registrationAllowed,
    ).toBe(true);
    // Seeded, not phantom: there is now a row an owner can edit and roll back.
    expect(result.current?.version).toBe(1);

    await alepha.stop();
  });
});
