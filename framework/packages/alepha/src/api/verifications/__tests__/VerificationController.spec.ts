import { Alepha, AlephaError } from "alepha";
import {
  ActorContentionError,
  ActorProvider,
  type ActorRequest,
} from "alepha/actor";
import { AlephaApiUsers, UserService } from "alepha/api/users";
import { AlephaOrmTestPostgres } from "alepha/orm";
import { AlephaServer, ServerProvider } from "alepha/server";
import { describe, it } from "vitest";

import {
  AlephaApiVerification,
  VerificationService,
  VerificationThrottledError,
} from "../index.ts";

/**
 * A counter store that fails every call, the way the spec says.
 */
class BrokenActorProvider extends ActorProvider {
  public static failure: Error = new AlephaError("actor store down");

  public override async execute(_request: ActorRequest): Promise<unknown> {
    throw BrokenActorProvider.failure;
  }
}

const setup = async (options: { brokenStore?: boolean } = {}) => {
  const alepha = Alepha.create({ env: { LOG_LEVEL: "error" } });
  if (options.brokenStore) {
    alepha.with({ provide: ActorProvider, use: BrokenActorProvider });
  }
  alepha
    .with(AlephaServer)
    .with(AlephaOrmTestPostgres)
    .with(AlephaApiVerification);
  const service = alepha.inject(VerificationService);
  await alepha.start();
  const { hostname } = alepha.inject(ServerProvider);
  const validate = async (type: string, target: string, token: string) => {
    const response = await fetch(
      `${hostname}/api/verifications/${type}/validate`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ target, token }),
      },
    );
    const body = (await response.json()) as {
      name?: string;
      message?: string;
      ok?: boolean;
    };
    return {
      status: response.status,
      message: body.message,
      ok: body.ok,
      name: body.name,
    };
  };
  return { service, validate };
};

describe("VerificationController", () => {
  it("answers a target with no entry exactly as it answers a wrong code", async ({
    expect,
  }) => {
    const { service, validate } = await setup();
    await service.createVerification({ type: "code", target: "+33611111111" });

    const wrong = await validate("code", "+33611111111", "000000");
    const absent = await validate("code", "+33622222222", "000000");

    expect(wrong).toMatchObject({
      status: 400,
      message: "Invalid or expired verification code",
    });
    expect(absent).toEqual(wrong);
  });

  it("answers a locked entry exactly as it answers a wrong code", async ({
    expect,
  }) => {
    const { service, validate } = await setup();
    const { token } = await service.createVerification({
      type: "link",
      target: "locked@example.com",
    });
    for (let i = 0; i < 3; i++) {
      await validate("link", "locked@example.com", "wrong");
    }

    expect(await validate("link", "locked@example.com", token)).toMatchObject({
      status: 400,
      message: "Invalid or expired verification code",
    });
  });

  it("tells a throttled caller it is throttled, by name, not that its code is wrong", async ({
    expect,
  }) => {
    const { service, validate } = await setup();
    const { token } = await service.createVerification({
      type: "code",
      target: "+33611111111",
    });

    const statuses: number[] = [];
    for (let i = 0; i < 10; i++) {
      statuses.push((await validate("code", "+33611111111", "000000")).status);
    }
    const throttled = await validate("code", "+33611111111", token);

    expect(statuses).toEqual(Array(10).fill(400));
    expect(throttled).toMatchObject({
      status: 429,
      name: "VERIFICATION_THROTTLED",
    });
  });

  it("accepts a valid code while another target behind the same address is throttled", async ({
    expect,
  }) => {
    const { service, validate } = await setup();
    const { token } = await service.createVerification({
      type: "code",
      target: "careful@example.com",
    });
    for (let i = 0; i < 11; i++) {
      await validate("code", "clumsy@example.com", "000000");
    }

    expect(
      (await validate("code", "clumsy@example.com", "000000")).status,
    ).toBe(429);
    expect(await validate("code", "careful@example.com", token)).toMatchObject({
      status: 200,
      ok: true,
    });
  });

  it("stops an address after a hundred refused codes, whatever the targets", async ({
    expect,
  }) => {
    const { validate } = await setup();

    const statuses = new Set<number>();
    for (let i = 0; i < 100; i++) {
      statuses.add((await validate("code", `+3360000${i}`, "000000")).status);
    }

    expect([...statuses]).toEqual([400]);
    expect(await validate("code", "+33699999999", "000000")).toMatchObject({
      status: 429,
      name: "VERIFICATION_THROTTLED",
    });
  });

  it("answers a counter it cannot reach as unavailable, never as a refusal", async ({
    expect,
  }) => {
    for (const failure of [
      new AlephaError("actor store down"),
      new ActorContentionError(),
    ]) {
      BrokenActorProvider.failure = failure;
      const { validate } = await setup({ brokenStore: true });

      expect(await validate("code", "+33611111111", "000000")).toMatchObject({
        status: 503,
        message: "Verification is temporarily unavailable",
      });
    }
  });

  it("lets the throttle through the account flows that check a code", async ({
    expect,
  }) => {
    const alepha = Alepha.create({ env: { LOG_LEVEL: "error" } })
      .with(AlephaOrmTestPostgres)
      .with(AlephaApiUsers);
    const users = alepha.inject(UserService);
    await alepha.start();
    const verify = () =>
      alepha.fork(async () => {
        alepha.store.set("alepha.http.request", {
          ip: "10.0.0.1",
          headers: {},
        } as never);
        return users.verifyEmail("someone@example.com", "000000");
      });

    for (let i = 0; i < 10; i++) {
      await expect(verify()).rejects.toThrow(
        "Invalid or expired verification token",
      );
    }

    await expect(verify()).rejects.toBeInstanceOf(VerificationThrottledError);
  });

  it("does not count an accepted code against the caller", async ({
    expect,
  }) => {
    const { service, validate } = await setup();

    for (let i = 0; i < 12; i++) {
      const target = `user${i}@example.com`;
      const { token } = await service.createVerification({
        type: "code",
        target,
      });
      expect(await validate("code", target, token)).toMatchObject({
        status: 200,
        ok: true,
      });
    }
  });
});
