import { $repositories } from "alepha/orm";
import { relations } from "../relations.ts";

/**
 * The kind of service Lore is full of, written against relations.
 *
 * Every method here has a direct counterpart in `apps/lore/src/api` that
 * currently spells the join out by hand. The comments name them so the
 * comparison is checkable rather than rhetorical.
 */
export class CampaignService {
  db = $repositories(relations);

  /**
   * Members of a campaign.
   *
   * Lore's version (`CampaignController.ts:255-262`) is three steps: fetch the
   * characters, `.map()` the user ids out, then a second `findMany` with
   * `inArray` — plus a `Map` at the call site to put them back together.
   */
  async members(campaignId: number) {
    return await this.db.characters.findMany({
      where: { campaignId: { eq: campaignId } },
      include: { user: true },
    });
  }

  /**
   * A campaign's full detail page in one call.
   *
   * The equivalent in Lore is four queries issued by hand and stitched in the
   * controller. Here the shape of the response is the shape of the query.
   */
  async overview(campaignId: number) {
    return await this.db.campaigns.findOne({
      where: { id: { eq: campaignId } },
      include: {
        owner: { select: ["id", "name"] },
        characters: {
          orderBy: { column: "level", direction: "desc" },
          include: { user: { select: ["name"] } },
        },
        quests: {
          orderBy: { column: "id", direction: "desc" },
          limit: 10,
          include: { author: { select: ["name"] }, blockedBy: true },
        },
      },
    });
  }

  /**
   * A quest board, paginated.
   *
   * Relations resolve for the page that came back, not the whole table — so
   * page size bounds the work regardless of how large the campaign is.
   */
  async questBoard(campaignId: number, page: number) {
    return await this.db.quests.paginate(
      { page, size: 20 },
      {
        where: { campaignId: { eq: campaignId } },
        include: { author: { select: ["name"] }, watchers: { limit: 3 } },
      },
      { count: true },
    );
  }

  /**
   * Create a campaign and its opening cast in one transaction.
   *
   * Lore does this with an explicit `$transactional()` block and a loop that
   * threads the new campaign id into each character by hand.
   */
  async found(input: {
    title: string;
    ownerId: string;
    party: Array<{ name: string; level?: number }>;
  }) {
    return await this.db.campaigns.create({
      data: {
        title: input.title,
        ownerId: input.ownerId,
        characters: {
          create: input.party.map((member) => ({
            name: member.name,
            level: member.level ?? 1,
            userId: input.ownerId,
          })),
        },
      },
      include: { characters: true },
    });
  }

  /**
   * Onboard a brand new owner along with their first campaign.
   *
   * The other ordering: the user must exist before the campaign, because the
   * campaign's foreign key points at it. Declaring the nesting is enough — the
   * resolver works the order out from where the key lives.
   */
  async foundForNewOwner(input: {
    title: string;
    owner: { email: string; name: string };
  }) {
    return await this.db.campaigns.create({
      data: { title: input.title, owner: { create: input.owner } },
      include: { owner: true },
    });
  }

  /** Rename, and hand back the row with its owner already attached. */
  async rename(campaignId: number, title: string) {
    return await this.db.campaigns.update({
      where: { id: { eq: campaignId } },
      data: { title },
      include: { owner: { select: ["name"] } },
    });
  }

  /**
   * Watch a quest, idempotently.
   *
   * `upsert` without an `update` clause still writes — it sets the columns
   * from `create` — but the unique constraint on the pair means a repeat call
   * updates the existing row rather than adding a duplicate. Idempotent, which
   * is what a toggle-on wants.
   */
  async watch(questId: number, userId: string) {
    return await this.db.questWatchers.upsert({
      create: { questId, userId },
      target: ["questId", "userId"],
    });
  }

  async unwatch(questId: number, userId: string) {
    return await this.db.questWatchers.deleteMany({
      where: { questId: { eq: questId }, userId: { eq: userId } },
    });
  }

  /**
   * Quests a user is watching across every campaign.
   *
   * Many-to-many, and the junction never appears in the result.
   */
  async watchlist(userId: string) {
    const user = await this.db.users.findOne({
      where: { id: { eq: userId } },
      select: ["id", "name"],
      include: {
        watching: {
          select: ["id", "title"],
          include: { campaign: { select: ["title"] } },
        },
      },
    });

    return user?.watching ?? [];
  }
}
