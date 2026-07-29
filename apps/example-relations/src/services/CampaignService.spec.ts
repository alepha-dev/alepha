import { Alepha } from "alepha";
import { beforeEach, describe, expect, it } from "vitest";
import { CampaignService } from "./CampaignService.ts";

/**
 * Exercises the example service end to end.
 *
 * The point is that the service is real code, not illustration: if the API
 * were awkward to use from a normal service, that would show up here first.
 */
describe("CampaignService", () => {
  let alepha: Alepha;
  let service: CampaignService;

  beforeEach(async () => {
    alepha = Alepha.create({ env: { DATABASE_URL: "sqlite://:memory:" } });
    service = alepha.inject(CampaignService);
    await alepha.start();
  });

  const owner = async () =>
    await service.db.users.create({
      data: { email: "gm@example.com", name: "GM" },
    });

  it("founds a campaign with its opening cast in one call", async () => {
    const gm = await owner();

    const campaign = await service.found({
      title: "The Sunken Archive",
      ownerId: gm.id,
      party: [{ name: "Vex", level: 3 }, { name: "Rill" }],
    });

    expect(campaign.title).toBe("The Sunken Archive");
    expect(campaign.characters.map((c) => c.name).sort()).toEqual([
      "Rill",
      "Vex",
    ]);
    // The default applied, so the child really went through the entity schema.
    expect(campaign.characters.find((c) => c.name === "Rill")?.level).toBe(1);
  });

  it("onboards a new owner and their campaign together", async () => {
    const campaign = await service.foundForNewOwner({
      title: "First Light",
      owner: { email: "new@example.com", name: "Newcomer" },
    });

    expect(campaign.owner?.name).toBe("Newcomer");

    const persisted = await service.db.users.findOne({
      where: { email: { eq: "new@example.com" } },
    });
    expect(persisted).toBeDefined();
  });

  it("returns members with their user attached", async () => {
    const gm = await owner();
    const campaign = await service.found({
      title: "Members",
      ownerId: gm.id,
      party: [{ name: "Vex" }],
    });

    const members = await service.members(campaign.id);

    expect(members).toHaveLength(1);
    expect(members[0]?.user?.name).toBe("GM");
  });

  it("builds the whole overview in one statement", async () => {
    const gm = await owner();
    const campaign = await service.found({
      title: "Overview",
      ownerId: gm.id,
      party: [
        { name: "Vex", level: 3 },
        { name: "Rill", level: 5 },
      ],
    });
    await service.db.quests.create({
      data: {
        title: "Find the archive",
        campaignId: campaign.id,
        createdBy: gm.id,
      },
    });

    const tables: string[] = [];
    alepha.events.on("repository:read:before", (event: any) => {
      tables.push(event.tableName);
    });

    const overview = await service.overview(campaign.id);

    expect(overview?.owner).toEqual({ id: gm.id, name: "GM" });
    // Ordered by level, descending.
    expect(overview?.characters.map((c) => c.name)).toEqual(["Rill", "Vex"]);
    expect(overview?.quests[0]?.author).toEqual({ name: "GM" });

    // Six relations across three levels, and still one round trip — the whole
    // point of compiling the tree into subqueries rather than resolving it.
    expect(tables).toEqual(["campaigns", "users", "characters", "quests"]);
  });

  it("paginates the quest board and resolves relations per page", async () => {
    const gm = await owner();
    const campaign = await service.found({
      title: "Board",
      ownerId: gm.id,
      party: [],
    });

    for (let i = 0; i < 3; i++) {
      await service.db.quests.create({
        data: {
          title: `Quest ${i}`,
          campaignId: campaign.id,
          createdBy: gm.id,
        },
      });
    }

    const page = await service.questBoard(campaign.id, 0);

    expect(page.content).toHaveLength(3);
    expect(page.content[0]?.author).toEqual({ name: "GM" });
    expect(page.page.totalElements).toBe(3);
  });

  it("watches idempotently and unwatches", async () => {
    const gm = await owner();
    const campaign = await service.found({
      title: "Watching",
      ownerId: gm.id,
      party: [],
    });
    const quest = await service.db.quests.create({
      data: { title: "Watched", campaignId: campaign.id, createdBy: gm.id },
    });

    await service.watch(quest.id, gm.id);
    await service.watch(quest.id, gm.id);

    expect(await service.watchlist(gm.id)).toHaveLength(1);

    await service.unwatch(quest.id, gm.id);
    expect(await service.watchlist(gm.id)).toHaveLength(0);
  });

  it("returns a watchlist projected down to what the UI needs", async () => {
    const gm = await owner();
    const campaign = await service.found({
      title: "Projected",
      ownerId: gm.id,
      party: [],
    });
    const quest = await service.db.quests.create({
      data: { title: "Watched", campaignId: campaign.id, createdBy: gm.id },
    });
    await service.watch(quest.id, gm.id);

    const watchlist = await service.watchlist(gm.id);

    expect(watchlist).toHaveLength(1);
    expect(Object.keys(watchlist[0]!).sort()).toEqual([
      "campaign",
      "id",
      "title",
    ]);
    expect(watchlist[0]?.campaign).toEqual({ title: "Projected" });
  });

  it("renames and hands back the owner without a second query at the call site", async () => {
    const gm = await owner();
    const campaign = await service.found({
      title: "Before",
      ownerId: gm.id,
      party: [],
    });

    const renamed = await service.rename(campaign.id, "After");

    expect(renamed.title).toBe("After");
    expect(renamed.owner).toEqual({ name: "GM" });
  });
});
