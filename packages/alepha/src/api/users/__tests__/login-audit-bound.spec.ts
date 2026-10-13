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
 * #Q2622: the failure log after the password compare stays, but an attempt
 * the limiter refuses before the compare writes nothing, and every pre-compare
 * failure is bounded by a counter, so one address cannot write audit rows
 * without end.
 */
describe("login audit rows before the password compare", () => {
  const boot = async (options: { enabled?: boolean } = {}) => {
    class App {
      realm = $realm({});
    }
    const alepha = Alepha.create({ env: { LOG_LEVEL: "error" } });
    alepha.with(AlephaOrmPostgres);
    alepha.with(AlephaSecurity);
    alepha.with(AlephaApiUsers);
    alepha.with(App);
    await alepha.start();

    const email = `audit-bound-${crypto.randomUUID().slice(0, 8)}@example.com`;
    const sessionService = alepha.inject(SessionService);
    const user = await alepha
      .inject(UserService)
      .users()
      .create({ email, roles: ["user"], enabled: options.enabled ?? true });
    await sessionService.identities().create({
      provider: "local",
      providerUserId: email,
      userId: user.id,
      password: await alepha.inject(CryptoProvider).hashPassword("correct"),
    });

    const attempt = (ip: string | undefined, login: string, password: string) =>
      alepha.fork(async () => {
        alepha.store.set("alepha.http.request", { ip, headers: {} } as never);
        await sessionService
          .login("local", login, password)
          .catch((error: unknown) => {
            if (!(error instanceof InvalidCredentialsError)) throw error;
          });
      });

    const rows = async (filter: (row: any) => boolean) =>
      (
        await alepha
          .inject(AuditService)
          .find({ type: "auth", action: "login", size: 100 })
      ).content.filter(filter);

    return { alepha, email, user, attempt, rows };
  };

  it("writes one row per compared password, and none for a refusal by the limiter", async ({
    expect,
  }) => {
    const { email, user, attempt, rows } = await boot();
    const ip = `10.22.${Math.floor(Math.random() * 250)}.1`;
    for (let i = 0; i < 5; i++) await attempt(ip, email, "wrong");
    const compared = await rows((row) => row.resourceId === user.id);
    expect(compared).toHaveLength(5);
    expect(
      compared.every((row) => row.description === "Invalid password"),
    ).toBe(true);
    // The account is locked: these are refused before the compare.
    for (let i = 0; i < 5; i++) await attempt(ip, email, "wrong");
    expect(await rows((row) => row.resourceId === user.id)).toHaveLength(5);
  });

  it("stops writing disabled-account rows once the IP locks", async ({
    expect,
  }) => {
    const { alepha, email, user, attempt, rows } = await boot({
      enabled: false,
    });
    const ip = `10.23.${Math.floor(Math.random() * 250)}.1`;
    for (let i = 0; i < 25; i++) await attempt(ip, email, "correct");
    // The default IP budget is 15 per window.
    expect(await rows((row) => row.resourceId === user.id)).toHaveLength(15);
    const locks = (
      await alepha
        .inject(AuditService)
        .find({ type: "security", action: "rate_limited", size: 100 })
    ).content.filter((row) => (row.metadata as any)?.ip === ip);
    expect(locks).toHaveLength(1);
  });

  it("counts attempts with no client address against one shared bucket", async ({
    expect,
  }) => {
    const { attempt, rows } = await boot();
    const first = `nobody-${crypto.randomUUID().slice(0, 8)}@example.com`;
    const second = `nobody-${crypto.randomUUID().slice(0, 8)}@example.com`;
    // Two identifiers, one budget: the address-less attempts share it.
    for (let i = 0; i < 10; i++) await attempt(undefined, first, "wrong");
    for (let i = 0; i < 10; i++) await attempt(undefined, second, "wrong");
    const notFound = await rows((row) =>
      [first, second].includes((row.metadata as any)?.username),
    );
    expect(notFound).toHaveLength(15);
  });
});
