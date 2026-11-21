import { randomUUID } from "node:crypto";

import { Alepha, AlephaError } from "alepha";
import { AuditService } from "alepha/api/audits";
import {
  DatabaseProvider,
  NodeSqliteProvider,
  nodeSqliteOptions,
} from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import { describe, it } from "vitest";

import { AlephaApiKeys, ApiKeyService } from "../index.ts";

/**
 * SQLite that refuses a statement binding more than 100 values, which is
 * what Cloudflare D1 does (`too many SQL variables`).
 */
class D1CeilingProvider extends NodeSqliteProvider {
  public override readonly maxBoundParameters = 100;

  /**
   * The revoking UPDATE to fail, counted from 1; none by default.
   */
  public static failRevocation = 0;

  protected revocations = 0;

  protected override initDrizzle(): void {
    const database = this.sqlite as unknown as {
      prepare: (text: string) => unknown;
    };
    const prepare = database.prepare.bind(database);
    database.prepare = (text: string) => {
      const bound = text.split("?").length - 1;
      if (bound > this.maxBoundParameters) {
        throw new AlephaError(`too many SQL variables (${bound})`);
      }
      if (/^update "api_keys" set .*"revoked_at"/i.test(text)) {
        this.revocations += 1;
        if (this.revocations === D1CeilingProvider.failRevocation) {
          throw new AlephaError("connection reset");
        }
      }
      return prepare(text);
    };
    super.initDrizzle();
  }
}

describe("ApiKeyService on D1", () => {
  it("revokes more keys in one admin call than one statement binds", async ({
    expect,
  }) => {
    const alepha = Alepha.create({ env: { LOG_LEVEL: "error" } })
      .with({ provide: DatabaseProvider, use: D1CeilingProvider })
      .with(AlephaSecurity)
      .with(AlephaApiKeys);
    alepha.store.mut(nodeSqliteOptions, (old) => ({
      ...old,
      path: "sqlite://:memory:",
    }));
    await alepha.start();
    const service = alepha.inject(ApiKeyService);
    const created: Array<{ id: string; token: string }> = [];
    for (let i = 0; i < 230; i++) {
      const key = await service.create({
        userId: randomUUID(),
        name: `key-${i}`,
        roles: [],
      });
      created.push({ id: key.apiKey.id, token: key.token });
    }
    expect(await service.validate(created[229].token)).not.toBeNull();

    const revoked = await service.revokeManyByAdmin(created.map((k) => k.id));

    expect(revoked).toHaveLength(230);
    expect(await service.validate(created[0].token)).toBeNull();
    expect(await service.validate(created[229].token)).toBeNull();
    expect(await service.revokeManyByAdmin(created.map((k) => k.id))).toEqual(
      [],
    );
  });

  it("audits every key it revoked when a later batch fails", async ({
    expect,
  }) => {
    D1CeilingProvider.failRevocation = 2;
    const alepha = Alepha.create({ env: { LOG_LEVEL: "error" } })
      .with({ provide: DatabaseProvider, use: D1CeilingProvider })
      .with(AlephaSecurity)
      .with(AlephaApiKeys);
    alepha.store.mut(nodeSqliteOptions, (old) => ({
      ...old,
      path: "sqlite://:memory:",
    }));
    await alepha.start();
    const service = alepha.inject(ApiKeyService);
    const created: Array<{ id: string; token: string }> = [];
    for (let i = 0; i < 120; i++) {
      const key = await service.create({
        userId: randomUUID(),
        name: `key-${i}`,
        roles: [],
      });
      created.push({ id: key.apiKey.id, token: key.token });
    }

    await expect(
      service.revokeManyByAdmin(created.map((k) => k.id)),
    ).rejects.toThrow();
    D1CeilingProvider.failRevocation = 0;

    const revoked: string[] = [];
    for (const key of created) {
      if ((await service.validate(key.token)) === null) revoked.push(key.id);
    }
    const audited = await alepha
      .inject(AuditService)
      .find({ type: "api-key", action: "revoke", size: 100 });
    expect(revoked).toHaveLength(90);
    expect(new Set(audited.content.map((row) => row.resourceId))).toEqual(
      new Set(revoked),
    );
    expect(audited.content).toHaveLength(90);
  });
});
