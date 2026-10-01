import { Alepha } from "alepha";
import { AlephaOrmPostgres } from "alepha/orm/postgres";
import { AlephaSecurity } from "alepha/security";
import { describe, expect, it } from "vitest";

import { AlephaApiAudits } from "../index.ts";
import { AuditService } from "../services/AuditService.ts";

/**
 * `getFilterOptions` returned `resourceTypes` and `userRealms` as literals —
 * `["user","session","file","order","payment"]` and `["default"]` — so the
 * admin filter dropdown advertised values no row had and hid the ones that
 * existed.
 */
const setup = async () => {
  const alepha = Alepha.create({ env: { LOG_LEVEL: "error" } })
    .with(AlephaOrmPostgres)
    .with(AlephaSecurity)
    .with(AlephaApiAudits);

  const audits = alepha.inject(AuditService);
  await alepha.start();
  return { alepha, audits };
};

describe("audit filter options", () => {
  it("reports the resource types and realms actually present", async () => {
    const { alepha, audits } = await setup();

    await audits.create({
      type: "security",
      action: "login",
      resourceType: "campaign",
      userRealm: "tenant-a",
      success: true,
    } as never);
    await audits.create({
      type: "security",
      action: "login",
      resourceType: "invoice",
      userRealm: "tenant-b",
      success: true,
    } as never);
    await audits.create({
      type: "security",
      action: "login",
      resourceType: "campaign",
      userRealm: "tenant-a",
      success: true,
    } as never);

    const options = await audits.getDistinctFilterValues();

    expect([...options.resourceTypes].sort()).toEqual(["campaign", "invoice"]);
    expect([...options.userRealms].sort()).toEqual(["tenant-a", "tenant-b"]);

    // The fabricated defaults must be gone.
    expect(options.resourceTypes).not.toContain("order");
    expect(options.userRealms).not.toContain("default");

    await alepha.stop();
  });

  it("returns empty lists when nothing has been audited", async () => {
    const { alepha, audits } = await setup();

    const options = await audits.getDistinctFilterValues();

    expect(options.resourceTypes).toEqual([]);
    expect(options.userRealms).toEqual([]);

    await alepha.stop();
  });

  it("omits rows where the column is null", async () => {
    const { alepha, audits } = await setup();

    await audits.create({
      type: "security",
      action: "login",
      success: true,
    } as never);

    const options = await audits.getDistinctFilterValues();

    expect(options.resourceTypes).toEqual([]);
    expect(options.userRealms).toEqual([]);

    await alepha.stop();
  });
});
