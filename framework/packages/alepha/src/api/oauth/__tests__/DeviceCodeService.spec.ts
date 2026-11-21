import { Alepha, AlephaError } from "alepha";
import { ActorProvider, type ActorRequest } from "alepha/actor";
import { AlephaCache, CacheProvider, MemoryCacheProvider } from "alepha/cache";
import { DateTimeProvider } from "alepha/datetime";
import { describe, it } from "vitest";

import {
  DEVICE_CODE_TTL_SECONDS,
  DEVICE_POLL_INTERVAL_SECONDS,
  DEVICE_USER_CODE_MAX_ATTEMPTS,
  DeviceCodeService,
} from "../services/DeviceCodeService.ts";

/**
 * Counts the user-code lookups that actually reach the store.
 */
class CountingDeviceCodeService extends DeviceCodeService {
  public lookups = 0;

  public override normalize(userCode: string): string {
    this.lookups += 1;
    return super.normalize(userCode);
  }
}

/**
 * A counter store that is down: every actor call fails.
 */
class BrokenActorProvider extends ActorProvider {
  public override async execute(_request: ActorRequest): Promise<unknown> {
    throw new AlephaError("actor store down");
  }
}

/**
 * A store whose next write waits for the spec: the round trip a shared
 * cache (Redis, the database) puts between a read and the write after it.
 */
class GatedCacheProvider extends MemoryCacheProvider {
  public gate: Promise<void> | undefined;

  public override async set(
    name: string,
    key: string,
    value: Uint8Array,
    ttl?: number,
  ): Promise<Uint8Array> {
    const gate = this.gate;
    if (gate) {
      this.gate = undefined;
      await gate;
    }
    return super.set(name, key, value, ttl);
  }
}

const start = async (options: { brokenStore?: boolean } = {}) => {
  const alepha = Alepha.create().with({
    provide: CacheProvider,
    use: GatedCacheProvider,
  });
  if (options.brokenStore)
    alepha.with({ provide: ActorProvider, use: BrokenActorProvider });
  alepha.with({ provide: DeviceCodeService, use: CountingDeviceCodeService });
  alepha.with(AlephaCache);
  const service = alepha.inject(DeviceCodeService) as CountingDeviceCodeService;
  const time = alepha.inject(DateTimeProvider);
  await alepha.start();
  const cache = alepha.inject(CacheProvider) as GatedCacheProvider;
  return { alepha, service, time, cache };
};

const anyClient = { clientId: "cli", scopes: ["openid"] };

describe("DeviceCodeService", () => {
  it("issues a device code and a human-readable user code", async ({
    expect,
  }) => {
    const { service } = await start();
    const record = await service.start(anyClient);

    expect(record.status).toBe("pending");
    // Grouped for reading aloud, which is the whole situation this grant exists
    // for.
    expect(record.userCode).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    // Never retyped, so it can be long, and it is the value that actually
    // protects the grant.
    expect(record.deviceCode.length).toBeGreaterThan(32);
  });

  it("never puts a confusable character in a user code", async ({ expect }) => {
    const { service } = await start();
    // 0/O, 1/I/L, 5/S, 2/Z, 8/B are exactly what gets mistyped reading a code
    // off one screen and into another.
    for (let i = 0; i < 200; i++) {
      const { userCode } = await service.start(anyClient);
      expect(userCode).not.toMatch(/[OIL01S5Z2B8AEU]/);
    }
  });

  it("finds an authorization from the code a human typed, however they typed it", async ({
    expect,
  }) => {
    const { service } = await start();
    const record = await service.start(anyClient);

    const lowerWithoutDash = record.userCode.toLowerCase().replace("-", "");
    const found = await service.byUserCode(lowerWithoutDash);
    expect(found?.deviceCode).toBe(record.deviceCode);
  });

  it("says nothing about codes it does not know", async ({ expect }) => {
    const { service } = await start();
    // Not "expired" versus "never existed": the approval page must not become
    // an oracle for guessing valid codes.
    expect(await service.byUserCode("XXXX-XXXX")).toBeUndefined();
  });

  it("stays pending until a human answers", async ({ expect }) => {
    const { service } = await start();
    const record = await service.start(anyClient);
    expect(await service.poll(record.deviceCode)).toEqual({
      status: "pending",
    });
  });

  it("hands over the grant once approved, and only once", async ({
    expect,
  }) => {
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

  /**
   * #Q2388. The token endpoint binds the session to this, not to whatever
   * `client_id` the poll carries, so the service has to hand it back.
   */
  it("names the client the flow started as when it hands over the grant", async ({
    expect,
  }) => {
    const { service, time } = await start();
    const record = await service.start({
      clientId: "alepha-cli",
      scopes: ["cli"],
    });
    await service.decide(record.userCode, "approve", "user-1");

    await time.travel([DEVICE_POLL_INTERVAL_SECONDS + 1, "seconds"]);
    expect(await service.poll(record.deviceCode)).toEqual({
      status: "approved",
      userId: "user-1",
      clientId: "alepha-cli",
      scopes: ["cli"],
      resource: undefined,
    });
  });

  it("reports a denial, then forgets the code", async ({ expect }) => {
    const { service, time } = await start();
    const record = await service.start(anyClient);
    await service.decide(record.userCode, "deny", "user-1");

    await time.travel([DEVICE_POLL_INTERVAL_SECONDS + 1, "seconds"]);
    expect(await service.poll(record.deviceCode)).toEqual({ status: "denied" });

    await time.travel([DEVICE_POLL_INTERVAL_SECONDS + 1, "seconds"]);
    expect(await service.poll(record.deviceCode)).toEqual({
      status: "expired",
    });
    expect(await service.byUserCode(record.userCode)).toBeUndefined();
  });

  it("expires a pending code at expires_in, however often it was polled", async ({
    expect,
  }) => {
    const { service, time } = await start();
    const record = await service.start(anyClient);

    let last = await service.poll(record.deviceCode);
    for (let elapsed = 0; elapsed < 606; elapsed += 6) {
      await time.travel([6, "seconds"]);
      last = await service.poll(record.deviceCode);
    }

    expect(last).toEqual({ status: "expired" });
    expect(await service.byUserCode(record.userCode)).toBeUndefined();
  });

  it("hands over nothing for a code approved before expires_in and polled after", async ({
    expect,
  }) => {
    const { service, time } = await start();
    const record = await service.start(anyClient);
    await time.travel([DEVICE_CODE_TTL_SECONDS - 10, "seconds"]);
    await service.decide(record.userCode, "approve", "user-1");

    await time.travel([11, "seconds"]);

    expect(await service.poll(record.deviceCode)).toEqual({
      status: "expired",
    });
  });

  it("keeps an approval given while a poll was writing", async ({ expect }) => {
    const { service, time, cache } = await start();
    const record = await service.start(anyClient);
    let release = () => {};
    cache.gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    // The poll has read the pending record and is held on its write.
    const polling = service.poll(record.deviceCode);
    await service.decide(record.userCode, "approve", "user-1");
    release();
    const held = await polling;

    // The approval reaches the device: on the held poll or on its next one.
    await time.travel([DEVICE_POLL_INTERVAL_SECONDS + 1, "seconds"]);
    const answer =
      held.status === "approved" ? held : await service.poll(record.deviceCode);
    expect(answer).toMatchObject({ status: "approved", userId: "user-1" });
  });

  it("lets one of two concurrent answers through", async ({ expect }) => {
    const { service, time } = await start();
    const record = await service.start(anyClient);

    const answers = await Promise.allSettled([
      service.decide(record.userCode, "deny", "user-1"),
      service.decide(record.userCode, "approve", "user-2"),
    ]);

    expect(answers.map((answer) => answer.status).sort()).toEqual([
      "fulfilled",
      "rejected",
    ]);
    const kept = answers[0].status === "fulfilled" ? "denied" : "approved";
    await time.travel([DEVICE_POLL_INTERVAL_SECONDS + 1, "seconds"]);
    expect(await service.poll(record.deviceCode)).toMatchObject({
      status: kept,
    });
  });

  it("hands the grant to one of two concurrent polls", async ({ expect }) => {
    const { service, time } = await start();
    const record = await service.start(anyClient);
    await service.decide(record.userCode, "approve", "user-1");
    await time.travel([DEVICE_POLL_INTERVAL_SECONDS + 1, "seconds"]);

    const polls = await Promise.all([
      service.poll(record.deviceCode),
      service.poll(record.deviceCode),
    ]);

    expect(polls.filter((result) => result.status === "approved")).toHaveLength(
      1,
    );
  });

  it("refuses to answer the same code twice", async ({ expect }) => {
    const { service } = await start();
    const record = await service.start(anyClient);
    await service.decide(record.userCode, "deny", "user-1");

    // Otherwise a denied grant could be re-approved by whoever asks second.
    await expect(
      service.decide(record.userCode, "approve", "user-1"),
    ).rejects.toThrow();
  });

  it("slows down a client that ignores the interval", async ({ expect }) => {
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
    // never be let through, waiting the interval from the LAST accepted poll
    // is enough.
    await time.travel([DEVICE_POLL_INTERVAL_SECONDS + 1, "seconds"]);
    expect(await service.poll(record.deviceCode)).toEqual({
      status: "pending",
    });
  });

  it("treats an unknown device code as expired", async ({ expect }) => {
    const { service } = await start();
    expect(await service.poll("nope")).toEqual({ status: "expired" });
  });

  it("stops answering an approver past the wrong-code ceiling", async ({
    expect,
  }) => {
    const { service } = await start();
    const record = await service.start(anyClient);

    for (let i = 0; i < DEVICE_USER_CODE_MAX_ATTEMPTS; i++) {
      expect(await service.byUserCode("XXXX-XXXX", "guesser")).toBeUndefined();
    }

    // Even the RIGHT code, once the ceiling is reached. Answering it would
    // make the ceiling a speed bump rather than a limit.
    expect(
      await service.byUserCode(record.userCode, "guesser"),
    ).toBeUndefined();

    // And `decide` counts against the approver, so the same ceiling reaches
    // the endpoint an application actually exposes.
    await expect(
      service.decide(record.userCode, "approve", "guesser"),
    ).rejects.toThrow("Unknown or expired code");
  });

  it("counts wrong codes per asker, not globally", async ({ expect }) => {
    const { service } = await start();
    const record = await service.start(anyClient);

    for (let i = 0; i < DEVICE_USER_CODE_MAX_ATTEMPTS; i++) {
      await service.byUserCode("XXXX-XXXX", "guesser");
    }

    // Somebody else's spree must not lock out the person holding the code.
    const found = await service.byUserCode(record.userCode, "innocent");
    expect(found?.deviceCode).toBe(record.deviceCode);
  });

  it("does not count a correct code against the asker", async ({ expect }) => {
    const { service } = await start();
    const record = await service.start(anyClient);

    await service.byUserCode(record.userCode, "typist");
    // Had the right code counted, this would be the sixth attempt.
    for (let i = 0; i < DEVICE_USER_CODE_MAX_ATTEMPTS - 1; i++) {
      await service.byUserCode("XXXX-XXXX", "typist");
    }
    const found = await service.byUserCode(record.userCode, "typist");
    expect(found?.deviceCode).toBe(record.deviceCode);
  });

  it("leaves the ceiling off when nobody is named", async ({ expect }) => {
    const { service } = await start();
    const record = await service.start(anyClient);

    // No `by`, no accountability, no counter: an application that wants the
    // ceiling has to say who is asking.
    for (let i = 0; i < DEVICE_USER_CODE_MAX_ATTEMPTS + 3; i++) {
      expect(await service.byUserCode("XXXX-XXXX", "")).toBeUndefined();
    }
    const found = await service.byUserCode(record.userCode, "");
    expect(found?.deviceCode).toBe(record.deviceCode);
  });

  it("compares no more than the ceiling under a burst of parallel guesses", async ({
    expect,
  }) => {
    const { service } = await start();

    // Counted before the lookup: a burst cannot all read a count under the
    // ceiling, as the old check-then-count did.
    await Promise.all(
      Array.from({ length: 20 }, () =>
        service.byUserCode("XXXX-XXXX", "burst"),
      ),
    );
    expect(service.lookups).toBe(DEVICE_USER_CODE_MAX_ATTEMPTS);
  });

  it("answers 503 when the counter store is down", async ({ expect }) => {
    const { service } = await start({ brokenStore: true });
    const record = await service.start(anyClient);

    await expect(
      service.byUserCode(record.userCode, "someone"),
    ).rejects.toMatchObject({ status: 503 });
    // Without an asker there is no counter to fail.
    const found = await service.byUserCode(record.userCode);
    expect(found?.deviceCode).toBe(record.deviceCode);
  });
});
