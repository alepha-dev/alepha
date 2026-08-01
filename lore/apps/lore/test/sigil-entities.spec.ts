import { Alepha } from "alepha";
import { $repository, DatabaseProvider, sql } from "alepha/orm";
import { describe, it } from "vitest";
import { blights } from "../src/api/entities/blights.ts";
import { campaigns } from "../src/api/entities/campaigns.ts";
import { sigils } from "../src/api/entities/sigils.ts";
import { sigilViewsHourly } from "../src/api/entities/sigilViewsHourly.ts";
import { users } from "../src/api/entities/users.ts";

describe("sigil entities", () => {
  it("identifies a sigil by app + environment within a campaign", async ({
    expect,
  }) => {
    // `sigils` carries FKs to `campaigns` and `users`; the model builder
    // resolves every `db.ref(...)` target eagerly at boot, so both referenced
    // tables must have a repository too or schema sync throws "Referenced
    // table ... not found" before this test ever gets to assert anything.
    class Repos {
      campaigns = $repository(campaigns);
      users = $repository(users);
      sigils = $repository(sigils);
    }
    const alepha = Alepha.create().with(Repos);
    const repos = alepha.inject(Repos);
    await alepha.start();

    // `sigils.campaignId` is a real, enforced foreign key (unlike D1, this
    // in-memory sqlite does not ignore it) — a campaign row has to exist
    // before a sigil can reference it.
    const campaign = await repos.campaigns.create({
      title: "Test Campaign",
      createdBy: crypto.randomUUID(),
    });

    const created = await repos.sigils.create({
      campaignId: campaign.id,
      app: "lore",
      environment: "production",
      tokenHash: "h",
      tokenPrefix: "sg_abc",
      kinds: ["beacon", "vitals", "blights", "petition"],
      label: "lore / production",
    });

    expect(created.app).toBe("lore");
    expect(created.environment).toBe("production");
  });

  it("buckets views by the hour, not the day", async ({ expect }) => {
    expect(sigilViewsHourly.schema.shape.hour).toBeDefined();
    expect((sigilViewsHourly.schema.shape as any).date).toBeUndefined();
  });

  it("declares a real foreign key from blights.sigilId to sigils.id", async ({
    expect,
  }) => {
    // Regression guard: `.optional()` chained *after* `db.ref(...)` returns a
    // new wrapper that the model builder's `PG_REF in value` check never
    // sees (`pgAttr` mutates the schema object `db.ref()` returns, and
    // `.optional()` wraps rather than mutates) — so the column silently gets
    // no FK constraint at all. `.optional()` must be applied to the type
    // passed *into* `db.ref(...)`, not chained onto its result.
    class Repos {
      campaigns = $repository(campaigns);
      users = $repository(users);
      sigils = $repository(sigils);
      blights = $repository(blights);
    }
    const alepha = Alepha.create().with(Repos);
    alepha.inject(Repos);
    await alepha.start();

    const provider = alepha.inject(DatabaseProvider);
    const foreignKeys = await provider.execute(
      sql`PRAGMA foreign_key_list(blights)`,
    );

    const sigilForeignKey = foreignKeys.find((row) => row.table === "sigils");
    expect(sigilForeignKey).toBeDefined();
    expect(sigilForeignKey?.from).toBe("sigil_id");
    expect(sigilForeignKey?.on_delete).toBe("SET NULL");
  });
});
