import { $inject, type Static, t } from "alepha";
import { $logger } from "alepha/logger";
import { $repository, $transactional } from "alepha/orm";
import { $secure } from "alepha/security";
import {
  $action,
  BadRequestError,
  NotFoundError,
  okSchema,
} from "alepha/server";
import {
  QUEST_STATUS_PREFIX,
  type SigilBlight,
  sigilBlights,
} from "../entities/sigilBlights.ts";
import { sigils } from "../entities/sigils.ts";
import { AppSecurityProvider } from "../providers/AppSecurityProvider.ts";
import { QuestService } from "../services/QuestService.ts";

/** Zone every blight-forwarded quest is filed under — predictable triage. */
const BLIGHT_ZONE = "Blights";

/**
 * A blight row as exposed to the campaign owner's Blights inbox. Mirrors
 * the entity 1:1 — every field is included, but the UI must render
 * `name`, `message`, `stack` and `sourceUrl` as escaped plain text only
 * (attacker-controlled — see folio #12 + the entity-level note).
 */
const blightResourceSchema = t.object({
  id: t.integer(),
  sigilId: t.uuid(),
  fingerprint: t.string(),
  name: t.string(),
  message: t.string(),
  stack: t.string(),
  sourceUrl: t.string(),
  firstSeenAt: t.string(),
  lastSeenAt: t.string(),
  count: t.integer(),
  recentIps: t.array(t.string()),
  status: t.string(),
});

export type BlightResource = Static<typeof blightResourceSchema>;

/**
 * Owner-facing triage surface for blights — the deduplicated uncaught
 * exceptions captured by a campaign's sigils.
 *
 * Every endpoint is owner-gated via `AppSecurityProvider.assertOwner`,
 * mirroring `PetitionController`'s owner endpoints. Blights are scoped to
 * sigils, sigils are scoped to campaigns — so blight access is resolved
 * by joining through the campaign's sigils.
 *
 * ⚠️ SECURITY: `name`, `message`, `stack`, `sourceUrl` on a blight row are
 * 100% attacker-controlled. They are persisted verbatim and shown to the
 * campaign owner (the highest-value target). They must only ever be
 * rendered as escaped plain text — never markdown / `dangerouslySetInnerHTML`.
 * The forward-to-quest description embeds the stack as plain text too.
 * See folio #12.
 */
export class BlightController {
  protected log = $logger();
  protected blights = $repository(sigilBlights);
  protected sigils = $repository(sigils);
  protected security = $inject(AppSecurityProvider);
  protected questService = $inject(QuestService);

  /**
   * List blights for a campaign, newest-spread first (`count` desc).
   * Open-only by default; `includeResolved` also returns `resolved` and
   * `quest:*` rows. Owner-only.
   */
  listBlights = $action({
    use: [$secure({ permissions: ["campaign:read"] })],
    method: "GET",
    path: "/campaigns/:campaignId/blights",
    schema: {
      params: t.object({ campaignId: t.integer() }),
      query: t.object({
        includeResolved: t.optional(t.boolean()),
      }),
      response: t.object({
        items: t.array(blightResourceSchema),
        openCount: t.integer(),
      }),
    },
    handler: async ({ params, query, user }) => {
      await this.security.assertOwner(params.campaignId, user);

      const sigilIds = await this.campaignSigilIds(params.campaignId);
      if (sigilIds.length === 0) {
        return { items: [], openCount: 0 };
      }

      const all = await this.blights.findMany({
        where: { sigilId: { inArray: sigilIds } },
        orderBy: [{ column: "count", direction: "desc" }],
      });

      const openCount = all.filter((b) => b.status === "open").length;
      const items = query.includeResolved
        ? all
        : all.filter((b) => b.status === "open");

      return { items: items.map((b) => this.toResource(b)), openCount };
    },
  });

  /**
   * Count of `open` blights for a campaign — feeds the sidebar badge.
   * Owner-only.
   */
  countOpenBlights = $action({
    use: [$secure({ permissions: ["campaign:read"] })],
    method: "GET",
    path: "/campaigns/:campaignId/blights/count",
    schema: {
      params: t.object({ campaignId: t.integer() }),
      response: t.object({ count: t.integer() }),
    },
    handler: async ({ params, user }) => {
      await this.security.assertOwner(params.campaignId, user);

      const sigilIds = await this.campaignSigilIds(params.campaignId);
      if (sigilIds.length === 0) {
        return { count: 0 };
      }
      const open = await this.blights.findMany({
        where: { sigilId: { inArray: sigilIds }, status: { eq: "open" } },
      });
      return { count: open.length };
    },
  });

  /**
   * Resolve a blight — `status = "resolved"`. The row stays for audit; the
   * default inbox view hides it. Owner-only.
   */
  resolveBlight = $action({
    use: [$secure({ permissions: ["campaign:update"] })],
    method: "POST",
    path: "/campaigns/:campaignId/blights/:blightId/resolve",
    schema: {
      params: t.object({
        campaignId: t.integer(),
        blightId: t.integer(),
      }),
      response: okSchema,
    },
    handler: async ({ params, user }) => {
      await this.security.assertOwner(params.campaignId, user);
      const blight = await this.loadBlight(params.campaignId, params.blightId);
      await this.blights.updateById(blight.id, { status: "resolved" });
      return { ok: true };
    },
  });

  /**
   * Forward a blight to a new quest. Creates a quest in the campaign with
   * the blight's name/message as the title and the stack + spread summary
   * as the (plain-text) description, links the quest back via
   * `quests.source.sigilBlightId`, and flips the blight to
   * `status = "quest:<id>"`. Owner-only.
   */
  forwardBlightToQuest = $action({
    use: [$secure({ permissions: ["quest:create"] }), $transactional()],
    method: "POST",
    path: "/campaigns/:campaignId/blights/:blightId/forward",
    schema: {
      params: t.object({
        campaignId: t.integer(),
        blightId: t.integer(),
      }),
      response: t.object({ questId: t.integer(), questShortId: t.integer() }),
    },
    handler: async ({ params, user }) => {
      const { campaign } = await this.security.assertOwner(
        params.campaignId,
        user,
      );
      const blight = await this.loadBlight(params.campaignId, params.blightId);

      if (blight.status.startsWith(QUEST_STATUS_PREFIX)) {
        throw new BadRequestError("Blight already forwarded to a quest");
      }

      // Title: `[Blight] TypeError: cannot read…` — name + message,
      // truncated. Plain text, never rendered as markdown.
      const summary = [blight.name, blight.message]
        .filter((s) => s.trim().length > 0)
        .join(": ");
      const title = `[Blight] ${summary}`.slice(0, 200);

      // Description: attacker-controlled stack embedded as PLAIN TEXT.
      // The quest description is markdown-rendered downstream, so the
      // stack goes inside a fenced code block — fences make the content
      // verbatim/escaped and a stray ``` inside the stack is harmless
      // (it just ends the block early; no markup is interpreted).
      const ipCount = blight.recentIps.length;
      const description = [
        `Forwarded from blight #${blight.id} (${blight.fingerprint.slice(0, 12)}…).`,
        "",
        `Affected ${blight.count} sessions across ${ipCount} IPs.`,
        "",
        blight.sourceUrl ? `Source: ${blight.sourceUrl}` : "",
        "",
        "Stack:",
        "```",
        blight.stack || "(no stack captured)",
        "```",
        "",
        ipCount > 0
          ? `Recent IPs (hashed): ${blight.recentIps.join(", ")}`
          : "",
      ]
        .join("\n")
        .slice(0, 10_000);

      // Blight-forwarded quests always land in a dedicated "Blights" zone
      // (created on the campaign if absent) — predictable triage, not
      // whatever the campaign's arbitrary first zone happens to be.
      // Creation mechanics (shortId, zone-ensure, sanitizeHtml, defaults)
      // are shared with QuestController.createQuest via QuestService.
      const quest = await this.questService.createQuest(campaign, {
        campaignId: params.campaignId,
        title,
        description,
        zone: BLIGHT_ZONE,
        priority: "medium",
        difficulty: 2,
        tags: ["bug", "blight"],
        createdBy: user.id,
        source: { sigilBlightId: blight.id },
      });

      await this.blights.updateById(blight.id, {
        status: `${QUEST_STATUS_PREFIX}${quest.id}`,
      });

      return { questId: quest.id, questShortId: quest.shortId };
    },
  });

  /**
   * Hard-delete a blight row. Owner-only.
   */
  deleteBlight = $action({
    use: [$secure({ permissions: ["campaign:delete"] })],
    method: "DELETE",
    path: "/campaigns/:campaignId/blights/:blightId",
    schema: {
      params: t.object({
        campaignId: t.integer(),
        blightId: t.integer(),
      }),
      response: okSchema,
    },
    handler: async ({ params, user }) => {
      await this.security.assertOwner(params.campaignId, user);
      const blight = await this.loadBlight(params.campaignId, params.blightId);
      await this.blights.deleteById(blight.id);
      return { ok: true };
    },
  });

  /**
   * Resolve the ids of every sigil belonging to a campaign — the join key
   * between campaign-scoped requests and sigil-scoped blight rows.
   * Revoked sigils are included: their historical blights stay visible.
   */
  protected async campaignSigilIds(campaignId: number): Promise<string[]> {
    const rows = await this.sigils.findMany(
      { where: { campaignId: { eq: campaignId } } },
      { force: true },
    );
    return rows.map((s) => s.id);
  }

  /**
   * Load a blight by id, asserting it belongs to a sigil of the expected
   * campaign. Returns 404 otherwise — never leaks cross-campaign rows.
   */
  protected async loadBlight(
    campaignId: number,
    blightId: number,
  ): Promise<SigilBlight> {
    const blight = await this.blights.findOne({
      where: { id: { eq: blightId } },
    });
    if (!blight) {
      throw new NotFoundError("Blight not found");
    }
    const sigilIds = await this.campaignSigilIds(campaignId);
    if (!sigilIds.includes(blight.sigilId)) {
      throw new NotFoundError("Blight not found");
    }
    return blight;
  }

  protected toResource(b: SigilBlight): BlightResource {
    return {
      id: b.id,
      sigilId: b.sigilId,
      fingerprint: b.fingerprint,
      name: b.name,
      message: b.message,
      stack: b.stack ?? "",
      sourceUrl: b.sourceUrl ?? "",
      firstSeenAt: b.firstSeenAt,
      lastSeenAt: b.lastSeenAt,
      count: b.count ?? 1,
      recentIps: b.recentIps ?? [],
      status: b.status ?? "open",
    };
  }
}
