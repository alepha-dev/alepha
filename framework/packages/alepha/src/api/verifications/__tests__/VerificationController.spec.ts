import { Alepha } from "alepha";
import { AlephaOrmTestPostgres } from "alepha/orm";
import { AlephaServer, ServerProvider } from "alepha/server";
import { describe, it } from "vitest";

import { AlephaApiVerification, VerificationService } from "../index.ts";

const setup = async () => {
  const alepha = Alepha.create({ env: { LOG_LEVEL: "error" } })
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
    const body = (await response.json()) as { message?: string; ok?: boolean };
    return { status: response.status, message: body.message, ok: body.ok };
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

    expect(wrong).toEqual({
      status: 400,
      message: "Invalid or expired verification code",
      ok: undefined,
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

    expect(await validate("link", "locked@example.com", token)).toEqual({
      status: 400,
      message: "Invalid or expired verification code",
      ok: undefined,
    });
  });

  it("stops a caller after ten refused codes, whatever the targets", async ({
    expect,
  }) => {
    const { service, validate } = await setup();
    const { token } = await service.createVerification({
      type: "code",
      target: "+33611111111",
    });

    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) {
      statuses.push(
        (await validate("code", `+336000000${i}`, "000000")).status,
      );
    }

    expect(statuses).toEqual([...Array(10).fill(400), 429]);
    expect((await validate("code", "+33611111111", token)).status).toBe(429);
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
