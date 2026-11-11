import { Alepha } from "alepha";
import { AlephaApiUsers } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { AlephaOrm } from "alepha/orm";
import type { UserAccountToken } from "alepha/security";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { afterEach, beforeEach, describe, it } from "vitest";

import { EstateController, LoreDeployApi } from "../src/api/index.ts";
import { EstateCost } from "../src/api/schemas/EstateCost.ts";
import { createTestEstate } from "../src/testing/estates.ts";
import { DeployTestEntities } from "../src/testing/index.ts";

/**
 * What `lore estate provision` records on the estate (#Q3166): the
 * provider, the server, its type, zone and hourly price. A record only:
 * Lore holds no provider key.
 */
describe("estate provision record", () => {
  let alepha: Alepha;
  let controller: EstateController;
  let entities: DeployTestEntities;

  beforeEach(async () => {
    alepha = Alepha.create({
      env: {
        LOG_LEVEL: "error",
        DATABASE_URL: ":memory:",
        APP_SECRET: "estate-provision-spec-secret",
      },
    });
    alepha.with(AlephaOrm);
    alepha.with(AlephaServer);
    alepha.with(AlephaSecurity);
    alepha.with(AlephaEmail);
    alepha.with(AlephaApiUsers);
    alepha.with(LoreDeployApi);
    entities = alepha.inject(DeployTestEntities);
    await alepha.start();
    controller = alepha.inject(EstateController);
  });

  afterEach(async () => {
    await alepha.stop();
  });

  const user = async (email: string): Promise<UserAccountToken> => {
    const row = await entities.users.create({ email });
    return { id: row.id, roles: ["user"] };
  };

  it("records the server on the owner's estate and reads it back", async ({
    expect,
  }) => {
    const owner = await user("owner@example.com");
    const minted = await createTestEstate(alepha, owner, {
      slug: "small-skilled-pie",
    });
    const recorded = await controller.recordEstateProvision(
      {
        params: { estateId: minted.id },
        body: {
          provider: "scaleway",
          serverId: "srv-1",
          type: "DEV1-S",
          zone: "fr-par-1",
          hourlyPrice: 0.008976,
        },
      },
      { user: owner },
    );
    expect(recorded).toMatchObject({
      provider: "scaleway",
      providerServerId: "srv-1",
      providerServerType: "DEV1-S",
      providerZone: "fr-par-1",
      hourlyPrice: 0.008976,
    });
    expect(recorded.provisionedAt).toBeDefined();
    const read = await controller.getEstate(
      { params: { estateId: minted.id } },
      { user: owner },
    );
    expect(read.providerServerId).toBe("srv-1");
  });

  it("refuses another owner's estate as if it did not exist", async ({
    expect,
  }) => {
    const owner = await user("owner@example.com");
    const stranger = await user("stranger@example.com");
    const minted = await createTestEstate(alepha, owner, { slug: "pie" });
    await expect(
      controller.recordEstateProvision(
        {
          params: { estateId: minted.id },
          body: {
            provider: "scaleway",
            serverId: "srv-1",
            type: "DEV1-S",
            zone: "fr-par-1",
          },
        },
        { user: stranger },
      ),
    ).rejects.toThrow();
  });
});

describe("EstateCost (#Q3168)", () => {
  it("is the stored hourly price times the hours since provision, and nothing without both", ({
    expect,
  }) => {
    const start = Date.parse("2026-11-06T10:00:00Z");
    expect(
      EstateCost.soFar(
        { hourlyPrice: 0.01, provisionedAt: "2026-11-06T10:00:00Z" },
        start + 3 * 3_600_000,
      ),
    ).toBeCloseTo(0.03);
    expect(EstateCost.soFar({ hourlyPrice: 0.01 }, start)).toBeUndefined();
    expect(
      EstateCost.soFar({ provisionedAt: "2026-11-06T10:00:00Z" }, start),
    ).toBeUndefined();
  });
});
