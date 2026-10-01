import { randomUUID } from "node:crypto";

import { Alepha } from "alepha";
import { BackgroundTaskProvider } from "alepha/background";
import { DateTimeProvider } from "alepha/datetime";
import { AlephaOrmPostgres } from "alepha/orm/postgres";
import { $issuer, AlephaSecurity } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { describe, expect, it } from "vitest";

import { AlephaApiKeys } from "../index.ts";
import { apiKeyOptions } from "../parameters/ApiKeyParameters.ts";
import { ApiKeyService } from "../services/ApiKeyService.ts";

/**
 * Counts usage writes that have FINISHED, and cache misses. Counting in
 * process after `flush()` is the only sound observation: a row read back
 * right after a deferred write can win or lose the race either way.
 */
class TrackingApiKeyService extends ApiKeyService {
  public usageWrites = 0;
  public databaseReads = 0;

  protected async updateUsage(id: string, ip?: string): Promise<void> {
    await super.updateUsage(id, ip);
    this.usageWrites++;
  }

  protected async findByTokenHash(hash: string) {
    this.databaseReads++;
    return super.findByTokenHash(hash);
  }
}

class TestApp {
  issuer = $issuer({
    secret: "test-secret",
    roles: [{ name: "admin", permissions: [{ name: "*" }] }],
  });
}

const setup = async (usageWriteIntervalMinutes?: number) => {
  const alepha = Alepha.create()
    .with({ provide: ApiKeyService, use: TrackingApiKeyService })
    .with(AlephaOrmPostgres)
    .with(AlephaServer)
    .with(AlephaSecurity)
    .with(AlephaApiKeys);
  alepha.inject(TestApp);
  if (usageWriteIntervalMinutes !== undefined) {
    alepha.store.set(apiKeyOptions, {
      ...alepha.store.get(apiKeyOptions),
      usageWriteIntervalMinutes,
    });
  }

  const service = alepha.inject(TrackingApiKeyService);
  const background = alepha.inject(BackgroundTaskProvider);
  const time = alepha.inject(DateTimeProvider);
  await alepha.start();

  const { token } = await service.create({
    userId: randomUUID(),
    name: "Polling CI key",
    roles: ["admin"],
  });

  return { service, background, time, token };
};

describe("API key usage write throttle", () => {
  it("writes once for two validations inside the interval, on the cache-hit path", async () => {
    const { service, background, time, token } = await setup();
    time.pause();

    expect(await service.validate(token)).not.toBeNull();
    expect(await service.validate(token)).not.toBeNull();
    await background.flush();

    // The second validation was a cache hit: the throttle must hold there,
    // where the cached row's `lastUsedAt` is frozen and useless to it.
    expect(service.databaseReads).toBe(1);
    expect(service.usageWrites).toBe(1);
  });

  it("writes again once the interval has passed, still from the cache", async () => {
    const { service, background, time, token } = await setup();
    time.pause();

    await service.validate(token);
    await time.travel(4, "minutes");
    await service.validate(token);
    await background.flush();
    expect(service.usageWrites).toBe(1);

    await time.travel(2, "minutes");
    await service.validate(token);
    await background.flush();

    expect(service.databaseReads).toBe(1);
    expect(service.usageWrites).toBe(2);
  });

  it("writes on every call when the interval is 0", async () => {
    const { service, background, token } = await setup(0);

    await service.validate(token);
    await service.validate(token);
    await service.validate(token);
    await background.flush();

    expect(service.usageWrites).toBe(3);
  });

  it("throttles each key on its own", async () => {
    const { service, background, time, token } = await setup();
    time.pause();
    const other = await service.create({
      userId: randomUUID(),
      name: "Second key",
      roles: ["admin"],
    });

    await service.validate(token);
    await service.validate(other.token);
    await service.validate(token);
    await service.validate(other.token);
    await background.flush();

    expect(service.usageWrites).toBe(2);
  });
});
