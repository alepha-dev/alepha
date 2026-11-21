import { randomUUID } from "node:crypto";

import { Alepha } from "alepha";
import { MemoryCacheProvider } from "alepha/cache";
import { DateTimeProvider } from "alepha/datetime";
import {
  AlephaOrmTestPostgres,
  DatabaseProvider,
  NodePostgresProvider,
} from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import { describe, it } from "vitest";

import { AlephaApiKeys, ApiKeyService } from "../index.ts";

/**
 * Two containers on one Postgres schema: two instances of one application
 * behind a load balancer, or two isolates. Each has its own memory, so its
 * own validation cache.
 */
class SharedSchemaProvider extends NodePostgresProvider {
  public static shared: string | undefined;

  public static migrated = false;

  public static reset(): void {
    SharedSchemaProvider.shared = undefined;
    SharedSchemaProvider.migrated = false;
  }

  protected override schemaForTesting = (SharedSchemaProvider.shared ??=
    this.generateTestSchemaName());

  // The schema is created by the first instance. The test-mode sync of a
  // second one would create every type again and fail.
  public override async migrate(): Promise<void> {
    if (SharedSchemaProvider.migrated) return;
    await super.migrate();
    SharedSchemaProvider.migrated = true;
  }
}

const instance = async () => {
  const alepha = Alepha.create({ env: { LOG_LEVEL: "error" } })
    .with({ provide: DatabaseProvider, use: SharedSchemaProvider })
    .with(AlephaOrmTestPostgres)
    .with(AlephaSecurity)
    .with(AlephaApiKeys);
  await alepha.start();
  return {
    alepha,
    keys: alepha.inject(ApiKeyService),
    time: alepha.inject(DateTimeProvider),
  };
};

describe("ApiKeyService across instances", () => {
  it("stops a revoked or rotated-away token on another instance within 30 seconds", async ({
    expect,
  }) => {
    SharedSchemaProvider.reset();
    const a = await instance();
    const b = await instance();
    const userId = randomUUID();
    const revoked = await a.keys.create({ userId, name: "one", roles: [] });
    const rotated = await a.keys.create({ userId, name: "two", roles: [] });
    expect(await b.keys.validate(revoked.token)).not.toBeNull();
    expect(await b.keys.validate(rotated.token)).not.toBeNull();

    await a.keys.revoke(revoked.apiKey.id, userId);
    const renewed = await a.keys.rotate(rotated.apiKey.id, userId);

    // At once where it happened.
    expect(await a.keys.validate(revoked.token)).toBeNull();
    expect(await a.keys.validate(rotated.token)).toBeNull();
    expect(await a.keys.validate(renewed.token)).not.toBeNull();

    // Elsewhere, once the instance's own copy of the row has aged out.
    await b.time.travel([31, "seconds"]);
    expect(await b.keys.validate(revoked.token)).toBeNull();
    expect(await b.keys.validate(rotated.token)).toBeNull();
    expect(await b.keys.validate(renewed.token)).not.toBeNull();

    await b.alepha.stop();
    await a.alepha.stop();
  });

  it("remembers nothing about a token no key holds", async ({ expect }) => {
    SharedSchemaProvider.reset();
    const a = await instance();

    for (let i = 0; i < 300; i++) {
      expect(await a.keys.validate(`ak_unknown${i}`)).toBeNull();
    }

    expect(
      a.alepha.inject(MemoryCacheProvider).size("api:keys:validation"),
    ).toBe(0);
    await a.alepha.stop();
  });
});
