import { Alepha, AlephaError } from "alepha";
import {
  DatabaseProvider,
  NodeSqliteProvider,
  nodeSqliteOptions,
} from "alepha/orm";
import { $issuer, AlephaSecurity } from "alepha/security";
import { describe, it } from "vitest";

import { AdminAuditController } from "../controllers/AdminAuditController.ts";
import { AlephaApiAudits } from "../index.ts";
import { AuditService } from "../services/AuditService.ts";

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

class TestApp {
  issuer = $issuer({
    secret: "test-secret",
    roles: [{ name: "admin", permissions: [{ name: "*" }] }],
  });
}

describe("AdminAuditController on D1", () => {
  it("deletes more entries in one call than one statement binds", async ({
    expect,
  }) => {
    const alepha = Alepha.create({ env: { LOG_LEVEL: "error" } })
      .with({ provide: DatabaseProvider, use: D1CeilingProvider })
      .with(AlephaSecurity)
      .with(AlephaApiAudits)
      .with(TestApp);
    alepha.store.mut(nodeSqliteOptions, (old) => ({
      ...old,
      path: "sqlite://:memory:",
    }));
    const controller = alepha.inject(AdminAuditController);
    const audits = alepha.inject(AuditService);
    await alepha.start();
    const ids: string[] = [];
    for (let i = 0; i < 230; i++) {
      ids.push(String((await audits.create({ type: "t", action: "a" })).id));
    }
    const kept = await audits.create({ type: "t", action: "kept" });

    const { deleted } = await controller.deleteAudits.run(
      { body: { ids } },
      {
        user: { id: "00000000-0000-4000-8000-000000000001", roles: ["admin"] },
      },
    );

    expect(deleted).toHaveLength(230);
    expect((await audits.find({ type: "t" })).content.map((e) => e.id)).toEqual(
      [kept.id],
    );
  });
});
