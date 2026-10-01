import { randomUUID } from "node:crypto";

import { Alepha } from "alepha";
import { BackgroundTaskProvider } from "alepha/background";
import { DateTimeProvider } from "alepha/datetime";
import { AlephaOrmPostgres } from "alepha/orm/postgres";
import { $issuer, AlephaSecurity } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { describe, expect, it } from "vitest";

import { ApiKeyController } from "../controllers/ApiKeyController.ts";
import { AlephaApiKeys } from "../index.ts";
import {
  type ApiKeyOptions,
  apiKeyOptions,
} from "../parameters/ApiKeyParameters.ts";
import { ApiKeyService } from "../services/ApiKeyService.ts";

const DAY = 24 * 60 * 60 * 1000;

/**
 * Holds one database read open, so a rotation can land in the middle of a
 * validation that already read the pre-rotation row.
 */
class RacingApiKeyService extends ApiKeyService {
  public raceNextRead = false;
  public readReached = Promise.withResolvers<void>();
  public mayFinishRead = Promise.withResolvers<void>();

  protected async findByTokenHash(hash: string) {
    const row = await super.findByTokenHash(hash);
    if (this.raceNextRead) {
      this.raceNextRead = false;
      this.readReached.resolve();
      await this.mayFinishRead.promise;
    }
    return row;
  }
}

class TestApp {
  issuer = $issuer({
    secret: "test-secret",
    roles: [{ name: "admin", permissions: [{ name: "*" }] }],
  });
}

const setup = async (options: Partial<ApiKeyOptions> = {}) => {
  const alepha = Alepha.create()
    .with({ provide: ApiKeyService, use: RacingApiKeyService })
    .with(AlephaOrmPostgres)
    .with(AlephaServer)
    .with(AlephaSecurity)
    .with(AlephaApiKeys);
  alepha.inject(TestApp);
  alepha.store.set(apiKeyOptions, {
    ...alepha.store.get(apiKeyOptions),
    ...options,
  });
  const service = alepha.inject(RacingApiKeyService);
  const time = alepha.inject(DateTimeProvider);
  const background = alepha.inject(BackgroundTaskProvider);
  await alepha.start();
  time.pause();

  const userId = randomUUID();
  const { apiKey, token } = await service.create({
    userId,
    name: "CI pipeline",
    description: "Deploys from CI",
    roles: ["admin"],
    expiresIn: "30d",
  });

  return { alepha, service, time, background, userId, apiKey, token };
};

describe("rotating an API key", () => {
  it("kills the old token at once and hands back a new one for the same key", async () => {
    const { service, userId, apiKey, token } = await setup();

    // Cached, so a rotation that forgot the cache would be caught.
    expect(await service.validate(token)).not.toBeNull();

    const rotated = await service.rotate(apiKey.id, userId);

    expect(rotated.token).not.toBe(token);
    expect(await service.validate(token)).toBeNull();

    const identity = await service.validate(rotated.token);
    expect(identity?.id).toBe(userId);
    expect(identity?.roles).toEqual(["admin"]);

    expect(rotated.apiKey.id).toBe(apiKey.id);
    expect(rotated.apiKey.name).toBe("CI pipeline");
    expect(rotated.apiKey.description).toBe("Deploys from CI");
    expect(rotated.apiKey.tokenSuffix).toBe(rotated.token.slice(-8));
  });

  it("does not let an in-flight validation of the old token resurrect it", async () => {
    // The race revocation was hardened against, driven deterministically:
    // the validation reads the old row, the rotation lands, and the
    // validation resumes and would cache what it read.
    const { service, userId, apiKey, token } = await setup();

    service.raceNextRead = true;
    const inFlight = service.validate(token);
    await service.readReached.promise;

    const rotated = await service.rotate(apiKey.id, userId);

    service.mayFinishRead.resolve();
    await inFlight;

    expect(await service.validate(token)).toBeNull();
    expect(await service.validate(rotated.token)).not.toBeNull();
  });

  it("starts the usage history, the expiry and the rotation date again", async () => {
    const { service, time, background, userId, apiKey, token } = await setup();

    await service.validate(token);
    await background.flush();
    expect((await service.getById(apiKey.id)).usageCount).toBe(1);

    await time.travel(2, "days");
    const rotated = await service.rotate(apiKey.id, userId);
    const row = await service.getById(apiKey.id);

    expect(row.usageCount).toBe(0);
    expect(row.lastUsedAt).toBeUndefined();
    expect(row.lastUsedIp).toBeUndefined();
    expect(row.rotatedAt).toBe(new Date(time.nowMillis()).toISOString());
    // No expiresIn given: `defaultExpiresIn`, 90 days.
    expect(new Date(row.expiresAt!).getTime()).toBe(
      time.nowMillis() + 90 * DAY,
    );

    // The throttle forgot the old secret's write: the new one writes at once.
    await service.validate(rotated.token);
    await background.flush();
    expect((await service.getById(apiKey.id)).usageCount).toBe(1);
  });

  it("renews an expired key, and can rotate to no expiry while uncapped", async () => {
    const { service, time, userId, apiKey, token } = await setup();

    await time.travel(31, "days");
    expect(await service.validate(token)).toBeNull();
    expect((await service.getById(apiKey.id)).status).toBe("expired");

    const rotated = await service.rotate(apiKey.id, userId, {
      expiresIn: "never",
    });

    expect(await service.validate(rotated.token)).not.toBeNull();
    const row = await service.getById(apiKey.id);
    expect(row.status).toBe("active");
    expect(row.expiresAt).toBeUndefined();
  });

  it("refuses a revoked key", async () => {
    const { service, userId, apiKey } = await setup();

    await service.revoke(apiKey.id, userId);

    await expect(service.rotate(apiKey.id, userId)).rejects.toThrow("revoked");
  });

  it("refuses an expiresIn over maxExpiryDays, as creation does", async () => {
    const { service, userId, apiKey } = await setup({ maxExpiryDays: 30 });

    await expect(
      service.rotate(apiKey.id, userId, { expiresIn: "1y" }),
    ).rejects.toThrow("30 days");
    // And the default of 90 days is over the cap too: refused, not clamped.
    await expect(service.rotate(apiKey.id, userId)).rejects.toThrow("30 days");
  });

  it("refuses another owner's key", async () => {
    const { service, apiKey } = await setup();

    await expect(service.rotate(apiKey.id, randomUUID())).rejects.toThrow(
      "Not your API key",
    );
  });

  it("returns the new token once through the controller", async () => {
    const { alepha, service, userId, apiKey, token } = await setup();

    const response = await alepha
      .inject(ApiKeyController)
      .rotateMyApiKey.run(
        { params: { id: apiKey.id }, body: { expiresIn: "7d" } },
        { user: { id: userId, roles: ["admin"] } },
      );

    expect(response.id).toBe(apiKey.id);
    expect(response.token).not.toBe(token);
    expect(response).not.toHaveProperty("tokenHash");
    expect(await service.validate(response.token)).not.toBeNull();
  });
});
