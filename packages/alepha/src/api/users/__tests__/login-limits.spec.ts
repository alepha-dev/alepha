import { Alepha } from "alepha";
import { AuditService } from "alepha/api/audits";
import { AlephaOrmPostgres } from "alepha/orm/postgres";
import {
  AlephaSecurity,
  CryptoProvider,
  InvalidCredentialsError,
} from "alepha/security";
import { describe, it } from "vitest";

import {
  $realm,
  AlephaApiUsers,
  SessionService,
  UserService,
} from "../index.ts";

/**
 * Records the lockout mails `login` would send, whatever the realm's
 * notification feature says.
 */
class RecordingSessionService extends SessionService {
  public lockoutMails: string[] = [];

  protected override userNotifications(): any {
    return {
      accountLockout: {
        push: async (input: { contact: string }) => {
          this.lockoutMails.push(input.contact);
        },
      },
    };
  }
}

/**
 * #Q2626: the login counters on `$rateLimit`. The IP slot is taken before any
 * DB work and kept by every failure; the account slot is taken just before the
 * compare; a right password gives both back; lock audits are the caller's.
 */
describe("login on $rateLimit", () => {
  const boot = async () => {
    class App {
      realm = $realm({});
    }
    const alepha = Alepha.create({ env: { LOG_LEVEL: "error" } });
    alepha.with({ provide: SessionService, use: RecordingSessionService });
    alepha.with(AlephaOrmPostgres);
    alepha.with(AlephaSecurity);
    alepha.with(AlephaApiUsers);
    alepha.with(App);
    await alepha.start();

    const sessions = alepha.inject(RecordingSessionService);
    const crypto = alepha.inject(CryptoProvider);
    const createUser = async (
      options: { password?: string; enabled?: boolean } = {},
    ) => {
      const email = `limits-${globalThis.crypto.randomUUID().slice(0, 8)}@example.com`;
      const user = await alepha
        .inject(UserService)
        .users()
        .create({ email, roles: ["user"], enabled: options.enabled ?? true });
      const identity = await sessions.identities().create({
        provider: "local",
        providerUserId: email,
        userId: user.id,
        ...(options.password
          ? { password: await crypto.hashPassword(options.password) }
          : {}),
      });
      return { email, user, identity };
    };

    const login = (ip: string | undefined, email: string, password: string) =>
      alepha.fork(async () => {
        if (ip)
          alepha.store.set("alepha.http.request", { ip, headers: {} } as never);
        return sessions.login("local", email, password);
      });

    const locks = async () =>
      (
        await alepha
          .inject(AuditService)
          .find({ type: "security", action: "rate_limited", size: 100 })
      ).content;

    return { alepha, sessions, crypto, createUser, login, locks };
  };

  it("raises no lock audit and no lockout mail for a right password on the limit-th attempt", async ({
    expect,
  }) => {
    const { sessions, createUser, login, locks } = await boot();
    const { email, user } = await createUser({ password: "correct" });
    for (let i = 0; i < 4; i++)
      await expect(login(undefined, email, "wrong")).rejects.toThrow(
        InvalidCredentialsError,
      );
    // The fifth attempt fills the counter before its compare, and passes.
    expect((await login(undefined, email, "correct")).id).toBe(user.id);
    expect(
      (await locks()).filter((row) => row.resourceId === user.id),
    ).toHaveLength(0);
    expect(sessions.lockoutMails).toEqual([]);

    // A wrong fifth attempt, by contrast, locks and mails once. The success
    // gave its slot back, so the count is at four again.
    await expect(login(undefined, email, "wrong")).rejects.toThrow(
      InvalidCredentialsError,
    );
    expect(
      (await locks()).filter((row) => row.resourceId === user.id),
    ).toHaveLength(1);
    expect(sessions.lockoutMails).toEqual([email]);
  });

  it("spends no account slot on an account with no password", async ({
    expect,
  }) => {
    const { crypto, sessions, createUser, login } = await boot();
    const { email, user, identity } = await createUser();
    for (let i = 0; i < 8; i++)
      await expect(login(undefined, email, "anything")).rejects.toThrow(
        InvalidCredentialsError,
      );
    // The account gains a password: its budget is untouched.
    await sessions
      .identities()
      .updateById(identity.id, { password: await crypto.hashPassword("new") });
    for (let i = 0; i < 4; i++)
      await expect(login(undefined, email, "wrong")).rejects.toThrow(
        InvalidCredentialsError,
      );
    expect((await login(undefined, email, "new")).id).toBe(user.id);
  });

  it("keeps the IP slot on every failure before the compare, and audits the lock once", async ({
    expect,
  }) => {
    const { createUser, login, locks } = await boot();
    const ip = `10.31.${Math.floor(Math.random() * 250)}.7`;
    const noPassword = await createUser();
    const disabled = await createUser({ password: "correct", enabled: false });
    const valid = await createUser({ password: "correct" });
    const unknown = `nobody-${globalThis.crypto.randomUUID().slice(0, 8)}@example.com`;

    for (let i = 0; i < 5; i++) {
      await expect(login(ip, noPassword.email, "x")).rejects.toThrow(
        InvalidCredentialsError,
      );
      await expect(login(ip, disabled.email, "correct")).rejects.toThrow(
        InvalidCredentialsError,
      );
      await expect(login(ip, unknown, "x")).rejects.toThrow(
        InvalidCredentialsError,
      );
    }
    // Fifteen failures, none compared: the IP is locked, even for a valid
    // account with its right password.
    await expect(login(ip, valid.email, "correct")).rejects.toThrow(
      InvalidCredentialsError,
    );
    expect(
      (await locks()).filter((row) => (row.metadata as any)?.ip === ip),
    ).toHaveLength(1);
    // Another address is unaffected.
    expect((await login("10.32.0.1", valid.email, "correct")).id).toBe(
      valid.user.id,
    );
  });
});
