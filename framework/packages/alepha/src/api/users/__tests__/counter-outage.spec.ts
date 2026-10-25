import { Alepha, AlephaError } from "alepha";
import { ActorProvider, type ActorRequest } from "alepha/actor";
import { AlephaApiVerification } from "alepha/api/verifications";
import { AlephaEmail } from "alepha/email";
import { AlephaOrmPostgres } from "alepha/orm/postgres";
import { AlephaSecurity } from "alepha/security";
import { describe, it } from "vitest";

import {
  AlephaApiUsers,
  CredentialService,
  RegistrationService,
  UserNotifications,
} from "../index.ts";

/**
 * A counter store that is down: every actor call fails.
 */
class BrokenActorProvider extends ActorProvider {
  public override async execute(_request: ActorRequest): Promise<unknown> {
    throw new AlephaError("actor store down");
  }
}

/**
 * #Q2627: with the counter store down, the per-address limits of registration
 * and password reset fail closed with a 503. Not their limit refusal: "too
 * many attempts", or a reset request's silent success, would lie about an
 * outage, and a 503 says nothing about the address.
 */
describe("registration and password reset during a counter outage", () => {
  const boot = async () => {
    const alepha = Alepha.create({ env: { LOG_LEVEL: "error" } });
    alepha.with({ provide: ActorProvider, use: BrokenActorProvider });
    alepha.with(AlephaOrmPostgres);
    alepha.with(AlephaSecurity);
    alepha.with(AlephaEmail);
    alepha.with(AlephaApiVerification);
    alepha.with(AlephaApiUsers);
    alepha.with(UserNotifications);
    await alepha.start();

    const fromAddress = <T>(fn: () => Promise<T>) =>
      alepha.fork(async () => {
        alepha.store.set("alepha.http.request", {
          ip: "198.51.100.4",
          headers: {},
        } as never);
        return fn();
      });

    return {
      registration: alepha.inject(RegistrationService),
      credentials: alepha.inject(CredentialService),
      fromAddress,
    };
  };

  it("answers 503 to a registration intent", async ({ expect }) => {
    const { registration, fromAddress } = await boot();
    await expect(
      fromAddress(() =>
        registration.createRegistrationIntent({
          email: "outage@example.com",
          password: "Password123!",
        } as never),
      ),
    ).rejects.toMatchObject({ status: 503 });
  });

  it("answers 503 to a password reset request, not a silent success", async ({
    expect,
  }) => {
    const { credentials, fromAddress } = await boot();
    await expect(
      fromAddress(() =>
        credentials.createPasswordResetIntent("outage@example.com"),
      ),
    ).rejects.toMatchObject({ status: 503 });
  });

  it("answers 503 to a password reset completion", async ({ expect }) => {
    const { credentials, fromAddress } = await boot();
    await expect(
      fromAddress(() =>
        credentials.completePasswordReset({
          intentId: crypto.randomUUID(),
          code: "123456",
          newPassword: "NewPassword456!",
        }),
      ),
    ).rejects.toMatchObject({ status: 503 });
  });
});
