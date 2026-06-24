import { $inject, z } from "alepha";
import { $tool } from "alepha/mcp";
import { BadRequestError, NotFoundError } from "alepha/server";
import { CampaignController } from "../../api/controllers/CampaignController.ts";
import { DirectoryController } from "../../api/controllers/DirectoryController.ts";
import { FolioController } from "../../api/controllers/FolioController.ts";
import { FolioLinkService } from "../../api/services/FolioLinkService.ts";
import {
  folioFullSchema,
  folioRefParamsSchema,
  folioRefSchema,
} from "../schemas/index.ts";

/**
 * Pull a ~200-character window around the first match of `query` in `text`.
 * Used by `folio_search` so Claude can pick the right note without a follow-up
 * `folio_get`.
 */
const buildSnippet = (text: string, query: string, radius = 100): string => {
  if (!query) return text.slice(0, 240);
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return text.slice(0, 240);
  const start = Math.max(0, idx - radius);
  const end = Math.min(text.length, idx + query.length + radius);
  return (
    (start > 0 ? "…" : "") +
    text.slice(start, end) +
    (end < text.length ? "…" : "")
  );
};

/**
 * MCP tools for Folios — campaign-shared markdown notes that act as the
 * AI memory for a campaign. Mirrors the per-project `MEMORY.md` pattern
 * but scoped to a Lore campaign so every member (humans + agents) sees
 * and co-curates the same set.
 *
 * Designed for AI-first workflows: `folio_search` returns a snippet so the
 * model can disambiguate without a follow-up read; `folio_create` /
 * `folio_update` accept tags as a flat string array; every call requires
 * a `campaign` (or `campaign_name`) to scope reads/writes. For situational
 * awareness across a whole campaign, prefer the orientation tool
 * `campaign_context` — it returns the folio index alongside active quests
 * in one ~2K-token call.
 */
export class FolioTools {
  protected readonly folioController = $inject(FolioController);
  protected readonly campaignController = $inject(CampaignController);
  protected readonly directoryController = $inject(DirectoryController);
  protected readonly folioLinkService = $inject(FolioLinkService);

  /**
   * Resolve campaign ID from params (by ID or name). Required: at least one
   * must be provided, since folios are now scoped to a campaign.
   */
  protected async resolveCampaignId(
    campaign?: number,
    campaign_name?: string,
  ): Promise<number> {
    const campaigns = await this.campaignController.getMyCampaigns();

    if (campaign) {
      const found = campaigns.find((p) => p.id === campaign);
      if (!found) {
        throw new NotFoundError(`Campaign with ID ${campaign} not found`);
      }
      return found.id;
    }

    if (campaign_name) {
      const found = campaigns.find(
        (p) => p.title.toLowerCase() === campaign_name.toLowerCase(),
      );
      if (!found) {
        throw new NotFoundError(`Campaign "${campaign_name}" not found`);
      }
      return found.id;
    }

    throw new BadRequestError(
      "Campaign is required. Specify campaign ID or campaign_name.",
    );
  }

  /**
   * Accept either a global UUID `id` or a per-campaign `shortId` reference
   * (with `campaign` / `campaign_name`) and return the global folio id.
   */
  protected async resolveFolioId(params: {
    id?: string;
    shortId?: number;
    campaign?: number;
    campaign_name?: string;
  }): Promise<string> {
    if (params.id != null) return params.id;
    if (params.shortId != null) {
      const campaignId = await this.resolveCampaignId(
        params.campaign,
        params.campaign_name,
      );
      const folio = await this.folioController.getByShortId({
        params: { campaignId, shortId: params.shortId },
      });
      return folio.id;
    }
    throw new BadRequestError(
      "Folio reference required: pass `id` (global UUID) or `shortId` (per-campaign — also requires `campaign` or `campaign_name`).",
    );
  }

  // Folios live inside `archive_directories` (quest #66); use the
  // `directory_*` MCP tools to navigate the tree.

  /**
   * Resolve a `directory_shortId` MCP input to the global directory
   * UUID, scoped to the given campaign. Throws `NotFoundError` via the
   * underlying controller endpoint if the directory doesn't exist or
   * the caller isn't a member of the campaign.
   */
  protected async resolveDirectoryShortId(
    shortId: number | undefined,
    campaignId: number,
  ): Promise<string | undefined> {
    if (shortId === undefined) return undefined;
    const directory = await this.directoryController.getDirectoryByShortId({
      params: { campaignId, shortId },
    });
    return directory.id;
  }

  folio_list = $tool({
    description:
      "List the campaign's folios (markdown notes that act as the campaign's shared memory), newest first. Use `tag` to narrow by a tag. Returns id, title, tags, updatedAt — call `folio_get` to read full content. For initial orientation on a campaign, prefer `campaign_context` — it returns this same index alongside the active quests in one round-trip.",
    title: "List folios",
    annotations: {
      readOnlyHint: true,
      idempotentHint: true,
    },
    schema: {
      params: z.object({
        campaign: z.integer().optional(),
        campaign_name: z.string().optional(),
        tag: z.string().optional(),
        limit: z.integer().min(1).max(100).default(20).optional(),
      }),
      result: z.object({
        folios: z.array(folioRefSchema),
      }),
    },
    handler: async ({ params }) => {
      const campaignId = await this.resolveCampaignId(
        params.campaign,
        params.campaign_name,
      );
      const folios = await this.folioController.list({
        query: { tag: params.tag, limit: params.limit ?? 20, campaignId },
      });
      return {
        folios: folios.map((f) => ({
          id: f.id,
          shortId: f.shortId,
          title: f.title,
          tags: f.tags,
          summary: f.summary || undefined,
          updatedAt: f.updatedAt,
        })),
      };
    },
  });

  folio_search = $tool({
    description:
      "Search the campaign's folios by free-text query (matches title, tags, and content, case-insensitive). Returns id/title/tags + a ~200-char snippet around the match — use this before folio_get when looking something up.",
    title: "Search folios",
    annotations: {
      readOnlyHint: true,
      idempotentHint: true,
    },
    schema: {
      params: z.object({
        query: z.string().min(1),
        campaign: z.integer().optional(),
        campaign_name: z.string().optional(),
        tag: z.string().optional(),
        limit: z.integer().min(1).max(50).default(10).optional(),
      }),
      result: z.object({
        results: z.array(
          z.object({
            id: z.uuid(),
            shortId: z.integer(),
            title: z.string(),
            tags: z.array(z.string()),
            snippet: z.string(),
            updatedAt: z.string(),
          }),
        ),
      }),
    },
    handler: async ({ params }) => {
      const campaignId = await this.resolveCampaignId(
        params.campaign,
        params.campaign_name,
      );
      const folios = await this.folioController.list({
        query: {
          q: params.query,
          tag: params.tag,
          limit: params.limit ?? 10,
          campaignId,
        },
      });
      return {
        results: folios.map((f) => ({
          id: f.id,
          shortId: f.shortId,
          title: f.title,
          tags: f.tags,
          snippet: buildSnippet(f.content, params.query),
          updatedAt: f.updatedAt,
        })),
      };
    },
  });

  folio_tags = $tool({
    description:
      "List every tag used by folios in this campaign. Helpful before creating a folio so you can reuse existing tags instead of inventing new ones.",
    title: "List folio tags",
    annotations: {
      readOnlyHint: true,
      idempotentHint: true,
    },
    schema: {
      params: z.object({
        campaign: z.integer().optional(),
        campaign_name: z.string().optional(),
      }),
      result: z.object({ tags: z.array(z.string()) }),
    },
    handler: async ({ params }) => {
      const campaignId = await this.resolveCampaignId(
        params.campaign,
        params.campaign_name,
      );
      const tags = await this.folioController.listTags({
        query: { campaignId },
      });
      return { tags };
    },
  });

  folio_get = $tool({
    description:
      "Get the full content of a folio (markdown) plus its wiki-style links — `outbound` (folios this one references via `[[...]]`) and `inbound` (folios that link back here). Outbound entries also include `quest` and `blob` kinds when the folio references quests (`[[quest:#N]]`) or Archive blobs (`[[blob:#N]]`, `[[blob:<uuid>]]`, or `![alt](blob:#N)`). Use the `inbound` list as a backlink panel: it surfaces folios that may carry related context. Accepts either the global UUID `id` or the per-campaign `shortId` (with `campaign` / `campaign_name`).",
    title: "Get folio",
    annotations: {
      readOnlyHint: true,
      idempotentHint: true,
    },
    schema: {
      params: folioRefParamsSchema,
      result: folioFullSchema,
    },
    handler: async ({ params }) => {
      const id = await this.resolveFolioId(params);
      const [folio, links] = await Promise.all([
        this.folioController.get({ params: { id } }),
        this.folioController.getLinks({ params: { id } }),
      ]);
      return {
        id: folio.id,
        shortId: folio.shortId,
        title: folio.title,
        tags: folio.tags,
        summary: folio.summary || undefined,
        content: folio.content,
        createdAt: folio.createdAt,
        updatedAt: folio.updatedAt,
        links,
      };
    },
  });

  folio_create = $tool({
    description:
      "Create a new folio in a campaign — a markdown note that becomes part of the campaign's memory for AI agents. Provide `campaign` (id) or `campaign_name`. `content` is markdown. **Always set `summary`** — a 1-2 sentence (~200 chars) description of what the folio is for. It's the field other agents (and future calls of yours) read in `campaign_context` to decide whether to fetch the body. Without a summary, the index falls back to the title and orientation suffers. Reuse existing `tags` when possible (call `folio_tags` first); good tags make `folio_list` / `folio_search` calls precise.",
    title: "Create folio",
    annotations: { readOnlyHint: false, destructiveHint: false },
    schema: {
      params: z.object({
        campaign: z.integer().optional(),
        campaign_name: z.string().optional(),
        title: z.string().min(1).max(200),
        content: z.string().optional(),
        tags: z.array(z.string()).optional(),
        summary: z
          .string()
          .max(500)
          .describe(
            "1-2 sentence description of what the folio is for. Surfaced via `campaign_context`. Strongly recommended — without it, agents must fetch the body to orient.",
          )
          .optional(),
        directory_shortId: z
          .integer()
          .describe(
            "Place the folio in this archive directory (by per-campaign shortId). Omit to create at the campaign root. Directories come from the Archive module (#66) — list available ones via `directory_list`.",
          )
          .optional(),
        pinned: z
          .boolean()
          .describe(
            "Pin the folio. Pinned folios sort to the top of `folio_list` AND have their full content surfaced in `campaign_context` — they're the per-campaign equivalent of CLAUDE.md / AGENTS.md. Per-campaign pin (one shared pin set per campaign). Use sparingly: the 8K-char total budget across all pinned folios is consumed every time an agent calls `campaign_context`.",
          )
          .optional(),
      }),
      result: folioFullSchema,
    },
    handler: async ({ params }) => {
      const campaignId = await this.resolveCampaignId(
        params.campaign,
        params.campaign_name,
      );
      const directoryId = await this.resolveDirectoryShortId(
        params.directory_shortId,
        campaignId,
      );
      const folio = await this.folioController.create({
        body: {
          campaignId,
          title: params.title,
          content: params.content,
          tags: params.tags,
          summary: params.summary,
          directoryId: directoryId ?? undefined,
          pinned: params.pinned,
        },
      });
      return {
        id: folio.id,
        shortId: folio.shortId,
        title: folio.title,
        tags: folio.tags,
        summary: folio.summary || undefined,
        content: folio.content,
        createdAt: folio.createdAt,
        updatedAt: folio.updatedAt,
      };
    },
  });

  folio_update = $tool({
    description:
      "Update a folio. Any omitted field stays unchanged. Pass the full new tag array (it replaces the existing one). Updating `content` is a good moment to also refresh `summary` so the orientation index in `campaign_context` stays accurate.",
    title: "Update folio",
    annotations: { readOnlyHint: false, idempotentHint: true },
    schema: {
      params: folioRefParamsSchema.extend({
        title: z.string().min(1).max(200).optional(),
        content: z.string().optional(),
        tags: z.array(z.string()).optional(),
        summary: z
          .string()
          .max(500)
          .describe(
            "Updated 1-2 sentence description. Omit to keep the existing one.",
          )
          .optional(),
        directory_shortId: z
          .integer()
          .describe(
            "Move the folio into this archive directory (per-campaign shortId). Omit to leave the directory untouched. Pass 0 to move the folio to the campaign root.",
          )
          .optional(),
        pinned: z
          .boolean()
          .describe(
            "Pin or unpin the folio. Pinned folios surface their full content in `campaign_context` (capped at 8K chars total across all pinned). Omit to leave the current state untouched.",
          )
          .optional(),
      }),
      result: folioFullSchema,
    },
    handler: async ({ params }) => {
      const id = await this.resolveFolioId(params);
      // 0 is the sentinel for "move to root" since shortId is 1-based and
      // JSON-Schema can't easily express null on optional integers.
      let directoryId: string | null | undefined;
      if (params.directory_shortId === 0) {
        directoryId = null;
      } else if (params.directory_shortId !== undefined) {
        const campaignId = await this.resolveCampaignId(
          params.campaign,
          params.campaign_name,
        );
        directoryId = await this.resolveDirectoryShortId(
          params.directory_shortId,
          campaignId,
        );
      }
      const folio = await this.folioController.update({
        params: { id },
        body: {
          title: params.title,
          content: params.content,
          tags: params.tags,
          summary: params.summary,
          directoryId,
          pinned: params.pinned,
        },
      });
      return {
        id: folio.id,
        shortId: folio.shortId,
        title: folio.title,
        tags: folio.tags,
        summary: folio.summary || undefined,
        content: folio.content,
        createdAt: folio.createdAt,
        updatedAt: folio.updatedAt,
      };
    },
  });

  folio_history = $tool({
    description:
      "List the revision history of a folio (newest first). Each entry includes `action` (create / edit / rename / tag-change / revert), `at` timestamp, the user who made the change, and a snapshot of the folio's title/content/tags/summary at the time. Capped at 10 revisions per folio by default (oldest non-pinned drop off when the cap is exceeded). Use this to see how a folio evolved, then `folio_revert` to roll back if needed.",
    title: "Folio history",
    annotations: {
      readOnlyHint: true,
      idempotentHint: true,
    },
    schema: {
      params: folioRefParamsSchema,
      result: z.object({
        revisions: z.array(
          z.object({
            id: z.uuid(),
            at: z.string(),
            byUserId: z.uuid().optional(),
            action: z.enum([
              "create",
              "edit",
              "rename",
              "tag-change",
              "revert",
            ]),
            titleSnapshot: z.string(),
            tagsSnapshot: z.array(z.string()),
            summarySnapshot: z.string(),
            contentSnapshot: z.string(),
            pinned: z.boolean(),
          }),
        ),
      }),
    },
    handler: async ({ params }) => {
      const id = await this.resolveFolioId(params);
      const revisions = await this.folioController.listHistory({
        params: { id },
      });
      return {
        revisions: revisions.map((r) => ({
          id: r.id,
          at: r.at,
          byUserId: r.byUserId,
          action: r.action,
          titleSnapshot: r.titleSnapshot,
          tagsSnapshot: r.tagsSnapshot,
          summarySnapshot: r.summarySnapshot,
          contentSnapshot: r.contentSnapshot,
          pinned: r.pinned,
        })),
      };
    },
  });

  folio_revert = $tool({
    description:
      "Revert a folio to a prior revision. Doesn't truly rewind — it writes a NEW revision with the prior content, so the current (about-to-be-overwritten) state stays in history and you can undo the revert if it turns out wrong. Call `folio_history` first to pick the revisionId.",
    title: "Revert folio",
    annotations: {
      // Not destructive — it preserves the overwritten version in history.
      destructiveHint: false,
    },
    schema: {
      params: folioRefParamsSchema.extend({
        revisionId: z.uuid().describe("Revision UUID, from `folio_history`."),
      }),
      result: folioFullSchema,
    },
    handler: async ({ params }) => {
      const id = await this.resolveFolioId(params);
      const folio = await this.folioController.revertHistory({
        params: { id, revisionId: params.revisionId },
      });
      return {
        id: folio.id,
        shortId: folio.shortId,
        title: folio.title,
        tags: folio.tags,
        summary: folio.summary || undefined,
        content: folio.content,
        createdAt: folio.createdAt,
        updatedAt: folio.updatedAt,
      };
    },
  });

  folio_links_tidy = $tool({
    description:
      "Walk every folio in the campaign and rewrite stale `[[dir/sub/name]]` path tokens whose path no longer matches the target's current archive location. Only touches folio-type, slash-bearing, non-shortId refs that still resolve to a real folio; dangling references and `[[#N]]` / bare title refs are left alone. Targets at the campaign root get their path stripped (`[[name]]`); targets inside a directory get the full current chain (`[[dir/sub/name]]`). Preserves any `folio:` prefix and `#anchor` suffix verbatim. Each rewritten folio is saved as a single edit (one `folio_revisions` row). Pass `dryRun: true` to preview the change set without writing.",
    title: "Tidy stale folio path links",
    annotations: { destructiveHint: false, idempotentHint: true },
    schema: {
      params: z.object({
        campaign: z.integer().optional(),
        campaign_name: z.string().optional(),
        dryRun: z.boolean().optional(),
      }),
      result: z.object({
        scanned: z.integer(),
        rewritten: z.integer(),
        dryRun: z.boolean(),
        changes: z.array(
          z.object({
            folioShortId: z.integer(),
            tokens: z.array(
              z.object({
                before: z.string(),
                after: z.string(),
                count: z.integer(),
              }),
            ),
          }),
        ),
      }),
    },
    handler: async ({ params }) => {
      const campaignId = await this.resolveCampaignId(
        params.campaign,
        params.campaign_name,
      );
      const dryRun = params.dryRun === true;
      return this.folioLinkService.tidyStalePaths(campaignId, {
        dryRun,
        updateContent: async (folioId, newContent) => {
          await this.folioController.update({
            params: { id: folioId },
            body: { content: newContent },
          });
        },
      });
    },
  });

  folio_delete = $tool({
    description: "Delete a folio. This cannot be undone.",
    title: "Delete folio",
    annotations: {
      destructiveHint: true,
      idempotentHint: true, // deleting an already-deleted folio is a no-op
    },
    schema: {
      params: folioRefParamsSchema,
      result: z.object({ ok: z.boolean() }),
    },
    handler: async ({ params }) => {
      const id = await this.resolveFolioId(params);
      await this.folioController.delete({ params: { id } });
      return { ok: true };
    },
  });
}
