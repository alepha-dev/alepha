import { Alepha } from "alepha";
import { AuditService } from "alepha/api/audits";
import { AlephaOrmPostgres } from "alepha/orm/postgres";
import {
  AlephaSecurity,
  CryptoProvider,
  InvalidCredentialsError,
} from "alepha/security";
import { describe, it } from "vitest";

import { AlephaApiUsers } from "../index.ts";
import { $realm } from "../primitives/$realm.ts";
import { SessionService } from "../services/SessionService.ts";
import { UserService } from "../services/UserService.ts";

/**
 * A User-Agent is the client's to write, and an in-app browser's runs past
 * the 255 characters an audit column holds. Unclamped, the audit insert of a
 * failed login threw, and it ran BEFORE the failure was counted: every wrong
 * password sent with a long User-Agent went uncounted, so the lockout never
 * came (#Q2502).
 */
describe("a failed login with a 300-character User-Agent", () => {
  const userAgent = `Mozilla/5.0 ${"FBAN/FBIOS;".repeat(30)}`;

  const boot = async () => {
    class App {
      realm = $realm({});
    }

    const alepha = Alepha.create({ env: { LOG_LEVEL: "error" } });
    alepha.with(AlephaOrmPostgres);
    alepha.with(AlephaSecurity);
    alepha.with(AlephaApiUsers);
    alepha.with(App);
    await alepha.start();

    const email = `long-ua-${crypto.randomUUID().slice(0, 8)}@example.com`;
    const sessionService = alepha.inject(SessionService);
    const user = await alepha
      .inject(UserService)
      .users()
      .create({ email, roles: ["user"] });
    await sessionService.identities().create({
      provider: "local",
      providerUserId: email,
      userId: user.id,
      password: await alepha.inject(CryptoProvider).hashPassword("correct"),
    });

    return { alepha, sessionService, email, user };
  };

  it("is still counted, and the account locks after the fifth", async ({
    expect,
  }) => {
    const { alepha, sessionService, email } = await boot();

    await alepha.fork(async () => {
      alepha.store.set("alepha.http.request", {
        ip: "10.9.8.7",
        headers: { "user-agent": userAgent },
      } as never);

      for (let i = 0; i < 5; i++) {
        await expect(
          sessionService.login("local", email, "wrong"),
        ).rejects.toThrow(InvalidCredentialsError);
      }
    });

    // The right password from an ordinary browser, refused: the five
    // failures were counted. Uncounted, this signed in.
    await alepha.fork(async () => {
      alepha.store.set("alepha.http.request", {
        ip: "10.9.8.7",
        headers: { "user-agent": "Mozilla/5.0" },
      } as never);

      await expect(
        sessionService.login("local", email, "correct"),
      ).rejects.toThrow(InvalidCredentialsError);
    });
  });

  it("is audited with the User-Agent cut to the column", async ({ expect }) => {
    const { alepha, sessionService, email, user } = await boot();

    await alepha.fork(async () => {
      alepha.store.set("alepha.http.request", {
        ip: "10.9.8.6",
        headers: { "user-agent": userAgent },
        requestId: "r".repeat(300),
      } as never);

      await expect(
        sessionService.login("local", email, "wrong"),
      ).rejects.toThrow(InvalidCredentialsError);
    });

    const page = await alepha
      .inject(AuditService)
      .find({ type: "auth", action: "login" });
    const row = page.content.find((it) => it.resourceId === user.id);
    expect(row?.success).toBe(false);
    expect(row?.userAgent).toHaveLength(255);
    expect(row?.userAgent?.endsWith("…")).toBe(true);
    expect(row?.requestId).toHaveLength(255);
  });
});
