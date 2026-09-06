import { Alepha } from "alepha";
import { AlephaApiUsers } from "alepha/api/users";
import { DateTimeProvider } from "alepha/datetime";
import { AlephaEmail } from "alepha/email";
import { $repository, AlephaOrm } from "alepha/orm";
import type { UserAccountToken } from "alepha/security";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { afterEach, beforeEach, describe, it } from "vitest";

import { TestEntityRepositories } from "../../../test/fixtures/entities.ts";
import { EstateController } from "../controllers/EstateController.ts";
import { estateInventories } from "../entities/estateInventories.ts";
import { type Estate, estates } from "../entities/estates.ts";
import { LoreApi } from "../index.ts";
import type { EstateInventoryFrame } from "../schemas/estateInventoryFrameSchema.ts";
import { EstateInventoryService } from "./EstateInventoryService.ts";

class InventoryRepositories {
  estates = $repository(estates);
  inventories = $repository(estateInventories);
}

interface TestContext {
  alepha: Alepha;
  service: EstateInventoryService;
  estateApi: EstateController;
  repos: InventoryRepositories;
  entities: TestEntityRepositories;
  dateTime: DateTimeProvider;
}

const setup = async (): Promise<TestContext> => {
  const alepha = Alepha.create({
    env: { LOG_LEVEL: "error", DATABASE_URL: ":memory:" },
  });
  alepha.with(AlephaOrm);
  alepha.with(AlephaServer);
  alepha.with(AlephaSecurity);
  alepha.with(AlephaEmail);
  alepha.with(AlephaApiUsers);
  alepha.with(LoreApi);

  const entities = alepha.inject(TestEntityRepositories);
  const repos = alepha.inject(InventoryRepositories);

  await alepha.start();

  return {
    alepha,
    service: alepha.inject(EstateInventoryService),
    estateApi: alepha.inject(EstateController),
    repos,
    entities,
    dateTime: alepha.inject(DateTimeProvider),
  };
};

const createEstate = async (
  ctx: TestContext,
  slug: string,
): Promise<{ estate: Estate; user: UserAccountToken }> => {
  const created = await ctx.entities.users.create({});
  const user: UserAccountToken = { id: created.id, roles: ["user"] };
  const minted = await ctx.estateApi.createEstate({ body: { slug } }, { user });
  return {
    estate: await ctx.repos.estates.getOne({
      where: { id: { eq: minted.id } },
    }),
    user,
  };
};

/**
 * The machine's clock is deliberately far from Lore's, so a stamp copied
 * from the frame would be visible.
 */
const MACHINE_CLOCK = "2001-01-01T00:00:00.000Z";

const frame = (
  apps: string[],
  bayVersion = "0.31.0",
): EstateInventoryFrame => ({
  type: "inventory",
  at: MACHINE_CLOCK,
  host: { cores: 4, memTotalBytes: 8 * 1024 ** 3, bayVersion },
  apps: apps.map((app) => ({
    app,
    env: "production",
    running: true,
    state: "active",
    backups: false,
    problems: [],
  })),
});

describe("EstateInventoryService", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setup();
  });

  afterEach(async () => {
    await ctx.alepha.stop();
  });

  /**
   * The whole storage decision in one assertion. A machine pushes on
   * connect, on its tick and after every command that changes state, so an
   * append would grow without bound for a page that only shows the latest.
   */
  it("keeps one row per estate however many times a machine pushes", async ({
    expect,
  }) => {
    const { estate } = await createEstate(ctx, "ovh-1");

    await ctx.service.record(estate, frame(["lore"]));
    await ctx.service.record(estate, frame(["lore", "docs"]));
    await ctx.service.record(estate, frame(["docs"]));

    const rows = await ctx.repos.inventories.findMany({
      where: { estateId: { eq: estate.id } },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.apps.map((row) => row.app)).toEqual(["docs"]);
    expect(rows[0]?.appCount).toBe(1);
  });

  it("stamps reportedAt with Lore's clock and keeps the machine's as a claim", async ({
    expect,
  }) => {
    const { estate } = await createEstate(ctx, "ovh-2");
    ctx.dateTime.pause();

    await ctx.service.record(estate, frame(["lore"]));

    const row = await ctx.service.findFor(estate.id);
    expect(row?.at).toBe(MACHINE_CLOCK);
    expect(row?.reportedAt).toBe(
      new Date(ctx.dateTime.nowMillis()).toISOString(),
    );
    // A host whose clock is hours off must not make the console say
    // "reported 25 years ago" beside a connection that is up.
    expect(row?.reportedAt).not.toBe(MACHINE_CLOCK);
  });

  it("denormalises the app count and lifts the version off the host block", async ({
    expect,
  }) => {
    const { estate } = await createEstate(ctx, "ovh-3");

    await ctx.service.record(estate, frame(["lore", "docs", "api"], "0.32.1"));

    const row = await ctx.service.findFor(estate.id);
    // The count is stored so a list can say "3 apps" without deserializing
    // every host's array.
    expect(row?.appCount).toBe(3);
    expect(row?.bayVersion).toBe("0.32.1");
    expect(row?.host.cores).toBe(4);
  });

  /**
   * Absent is a state the console renders, and it is not an empty inventory:
   * a host with no apps and a host that never spoke are two different
   * sentences.
   */
  it("answers nothing for a machine that has never reported", async ({
    expect,
  }) => {
    const { estate } = await createEstate(ctx, "ovh-4");
    expect(await ctx.service.findFor(estate.id)).toBeUndefined();
  });

  it("keeps two estates' snapshots apart", async ({ expect }) => {
    const first = await createEstate(ctx, "ovh-5");
    const second = await createEstate(ctx, "ovh-6");

    await ctx.service.record(first.estate, frame(["lore"]));
    await ctx.service.record(second.estate, frame(["shop", "docs"]));

    expect((await ctx.service.findFor(first.estate.id))?.appCount).toBe(1);
    expect((await ctx.service.findFor(second.estate.id))?.appCount).toBe(2);
  });
});
