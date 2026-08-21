import { Alepha } from "alepha";
import { AlephaCache } from "alepha/cache";
import { DateTimeProvider } from "alepha/datetime";
import { describe, expect, it } from "vitest";

import {
  DEVICE_POLL_INTERVAL_SECONDS,
  DeviceCodeService,
} from "../services/DeviceCodeService.ts";

const start = async () => {
  const alepha = Alepha.create().with(AlephaCache);
  const service = alepha.inject(DeviceCodeService);
  const time = alepha.inject(DateTimeProvider);
  await alepha.start();
  return { alepha, service, time };
};

const anyClient = { clientId: "cli", scopes: ["openid"] };

describe("DeviceCodeService", () => {
  it("issues a device code and a human-readable user code", async () => {
    const { service } = await start();
    const record = await service.start(anyClient);

    expect(record.status).toBe("pending");
    // Grouped for reading aloud, which is the whole situation this grant exists
    // for.
    expect(record.userCode).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    // Never retyped, so it can be long — and it is the value that actually
    // protects the grant.
    expect(record.deviceCode.length).toBeGreaterThan(32);
  });

  it("never puts a confusable character in a user code", async () => {
    const { service } = await start();
    // 0/O, 1/I/L, 5/S, 2/Z, 8/B are exactly what gets mistyped reading a code
    // off one screen and into another.
    for (let i = 0; i < 200; i++) {
      const { userCode } = await service.start(anyClient);
      expect(userCode).not.toMatch(/[OIL01S5Z2B8AEU]/);
    }
  });

  it("finds an authorization from the code a human typed, however they typed it", async () => {
    const { service } = await start();
    const record = await service.start(anyClient);

    const lowerWithoutDash = record.userCode.toLowerCase().replace("-", "");
    const found = await service.byUserCode(lowerWithoutDash);
    expect(found?.deviceCode).toBe(record.deviceCode);
  });

  it("says nothing about codes it does not know", async () => {
    const { service } = await start();
    // Not "expired" versus "never existed": the approval page must not become
    // an oracle for guessing valid codes.
    expect(await service.byUserCode("XXXX-XXXX")).toBeUndefined();
  });

  it("stays pending until a human answers", async () => {
    const { service } = await start();
    const record = await service.start(anyClient);
    expect(await service.poll(record.deviceCode)).toEqual({
      status: "pending",
    });
  });

  it("hands over the grant once approved, and only once", async () => {
    const { service, time } = await start();
    const record = await service.start(anyClient);
    await service.decide(record.userCode, "approve", "user-1");

    await time.travel([DEVICE_POLL_INTERVAL_SECONDS + 1, "seconds"]);
    const first = await service.poll(record.deviceCode);
    expect(first).toMatchObject({ status: "approved", userId: "user-1" });

    // Single use: a leaked device code must not be replayable for a second
    // token.
    await time.travel([DEVICE_POLL_INTERVAL_SECONDS + 1, "seconds"]);
    expect(await service.poll(record.deviceCode)).toEqual({
      status: "expired",
    });
  });

  it("reports a denial, then forgets the code", async () => {
    const { service, time } = await start();
    const record = await service.start(anyClient);
    await service.decide(record.userCode, "deny", "user-1");

    await time.travel([DEVICE_POLL_INTERVAL_SECONDS + 1, "seconds"]);
    expect(await service.poll(record.deviceCode)).toEqual({ status: "denied" });
  });

  it("refuses to answer the same code twice", async () => {
    const { service } = await start();
    const record = await service.start(anyClient);
    await service.decide(record.userCode, "deny", "user-1");

    // Otherwise a denied grant could be re-approved by whoever asks second.
    await expect(
      service.decide(record.userCode, "approve", "user-1"),
    ).rejects.toThrow();
  });

  it("slows down a client that ignores the interval", async () => {
    const { service, time } = await start();
    const record = await service.start(anyClient);

    await time.travel([DEVICE_POLL_INTERVAL_SECONDS + 1, "seconds"]);
    expect(await service.poll(record.deviceCode)).toEqual({
      status: "pending",
    });

    // Immediately again: too fast.
    expect(await service.poll(record.deviceCode)).toEqual({
      status: "slow_down",
    });

    // A hammering client must not keep pushing its own window forward and
    // never be let through — waiting the interval from the LAST accepted poll
    // is enough.
    await time.travel([DEVICE_POLL_INTERVAL_SECONDS + 1, "seconds"]);
    expect(await service.poll(record.deviceCode)).toEqual({
      status: "pending",
    });
  });

  it("treats an unknown device code as expired", async () => {
    const { service } = await start();
    expect(await service.poll("nope")).toEqual({ status: "expired" });
  });

  it("compares user codes without leaking length-independent timing", async () => {
    const { service } = await start();
    const record = await service.start(anyClient);
    expect(service.matches(record.userCode, record.userCode)).toBe(true);
    expect(service.matches(record.userCode, "CDFG-HJKM")).toBe(false);
    // Different lengths must not throw — timingSafeEqual does, on its own.
    expect(service.matches(record.userCode, "SHORT")).toBe(false);
  });
});
