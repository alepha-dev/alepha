import { randomUUID } from "node:crypto";

import { Alepha, AlephaError } from "alepha";
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
});
