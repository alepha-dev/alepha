import { $inject, t } from "alepha";
import { $tool } from "alepha/mcp";
import { BadRequestError, NotFoundError } from "alepha/server";
import { CampaignController } from "../../api/controllers/CampaignController.ts";
import { FolioController } from "../../api/controllers/FolioController.ts";
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
 * MCP tools for Folios — markdown notes that act as the calling user's
 * memory for a campaign. Mirrors the per-project `MEMORY.md` pattern but
 * scoped to a Lore campaign so multiple agents (and humans) can co-curate.
 *
 * Designed for AI-first workflows: `folio_search` returns a snippet so the
 * model can disambiguate without a follow-up read; `folio_create` /
 * `folio_update` accept tags as a flat string array; all writes are scoped
 * to the authenticated user. For situational awareness across a whole
 * campaign, prefer the orientation tool `campaign_context` — it returns
 * the folio index alongside active quests in one ~2K-token call.
 */
export class FolioTools {
  protected readonly folioController = $inject(FolioController);
  protected readonly campaignController = $inject(CampaignController);

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

  /**
   * Resolve a parent folio reference passed by an agent into a global
   * folio UUID. Supports `parent_shortId` (preferred, since `shortId` is
   * stable in conversation) or a raw `parentId`. Returns `undefined`
   * when neither is set and `null` to clear the parent.
   */
  protected async resolveParentRef(params: {
    parent_shortId?: number;
    parentId?: string | null;
    campaign?: number;
    campaign_name?: string;
  }): Promise<string | null | undefined> {
    if (params.parent_shortId !== undefined) {
      const campaignId = await this.resolveCampaignId(
        params.campaign,
        params.campaign_name,
      );
      const parent = await this.folioController.getByShortId({
        params: { campaignId, shortId: params.parent_shortId },
      });
      return parent.id;
    }
    if ("parentId" in params) return params.parentId ?? null;
    return undefined;
  }

  /**
   * Return the ancestor chain (root → … → direct parent) for a folio,
   * each segment carrying the per-campaign `shortId` + `title`. Empty
   * when the folio is at root. Defensive against unexpected cycles
   * (bounded by MAX_FOLIO_DEPTH).
   */
  protected async buildFolioPath(
    folioId: string,
  ): Promise<{ shortId: number; title: string }[]> {
    const reversed: { shortId: number; title: string }[] = [];
    let cursorId: string | undefined = folioId;
    const seen = new Set<string>();
    while (cursorId && !seen.has(cursorId)) {
      seen.add(cursorId);
      const folio = (await this.folioController.get({
        params: { id: cursorId },
      })) as {
        id: string;
        parentId?: string;
        shortId: number;
        title: string;
      };
      const nextParentId = folio.parentId;
      if (!nextParentId) break;
      const parent = (await this.folioController.get({
        params: { id: nextParentId },
      })) as { id: string; shortId: number; title: string };
      reversed.push({ shortId: parent.shortId, title: parent.title });
      cursorId = parent.id;
      if (reversed.length >= 10) break;
    }
    return reversed.reverse();
  }

  /**
   * Look up the per-campaign shortId of the direct parent, if any.
   * Useful for surfacing in `folio_get` alongside `path`.
   */
  protected async resolveParentShortId(
    folioId: string,
  ): Promise<number | undefined> {
    const folio = (await this.folioController.get({
      params: { id: folioId },
    })) as { parentId?: string };
    if (!folio.parentId) return undefined;
    const parent = (await this.folioController.get({
      params: { id: folio.parentId },
    })) as { shortId: number };
    return parent.shortId;
  }

  folio_list = $tool({
    description:
      "List the user's folios (markdown notes that act as the campaign's memory for this user), newest first. Use `tag` to narrow by a tag. Returns id, title, tags, updatedAt — call `folio_get` to read full content. For initial orientation on a campaign, prefer `campaign_context` — it returns this same index alongside the active quests in one round-trip.",
    title: "List folios",
    annotations: {
      readOnlyHint: true,
      idempotentHint: true,
    },
    schema: {
      params: t.object({
        campaign: t.optional(t.integer()),
        campaign_name: t.optional(t.string()),
        tag: t.optional(t.string()),
        limit: t.optional(t.integer({ minimum: 1, maximum: 100, default: 20 })),
      }),
      result: t.object({
        folios: t.array(folioRefSchema),
      }),
    },
    handler: async ({ params }) => {
      const campaignId =
        params.campaign || params.campaign_name
          ? await this.resolveCampaignId(params.campaign, params.campaign_name)
          : undefined;
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
      "Search the user's folios by free-text query (matches title, tags, and content, case-insensitive). Returns id/title/tags + a ~200-char snippet around the match — use this before folio_get when looking something up.",
    title: "Search folios",
    annotations: {
      readOnlyHint: true,
      idempotentHint: true,
    },
    schema: {
      params: t.object({
        query: t.string({ minLength: 1 }),
        campaign: t.optional(t.integer()),
        campaign_name: t.optional(t.string()),
        tag: t.optional(t.string()),
        limit: t.optional(t.integer({ minimum: 1, maximum: 50, default: 10 })),
      }),
      result: t.object({
        results: t.array(
          t.object({
            id: t.uuid(),
            shortId: t.integer(),
            title: t.string(),
            tags: t.array(t.string()),
            snippet: t.string(),
            updatedAt: t.string(),
          }),
        ),
      }),
    },
    handler: async ({ params }) => {
      const campaignId =
        params.campaign || params.campaign_name
          ? await this.resolveCampaignId(params.campaign, params.campaign_name)
          : undefined;
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
      "List every tag the user has ever used. Helpful before creating a folio so you can reuse existing tags instead of inventing new ones.",
    title: "List folio tags",
    annotations: {
      readOnlyHint: true,
      idempotentHint: true,
    },
    schema: {
      params: t.object({
        campaign: t.optional(t.integer()),
        campaign_name: t.optional(t.string()),
      }),
      result: t.object({ tags: t.array(t.string()) }),
    },
    handler: async ({ params }) => {
      const campaignId =
        params.campaign || params.campaign_name
          ? await this.resolveCampaignId(params.campaign, params.campaign_name)
          : undefined;
      const tags = await this.folioController.listTags({
        query: { campaignId },
      });
      return { tags };
    },
  });

  folio_get = $tool({
    description:
      "Get the full content of a folio (markdown) plus its wiki-style links — `outbound` (folios this one references via `[[...]]`) and `inbound` (folios that link back here). Use the `inbound` list as a backlink panel: it surfaces folios that may carry related context. Accepts either the global UUID `id` or the per-campaign `shortId` (with `campaign` / `campaign_name`).",
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
      const [folio, links, path, parentShortId] = await Promise.all([
        this.folioController.get({ params: { id } }),
        this.folioController.getLinks({ params: { id } }),
        this.buildFolioPath(id),
        this.resolveParentShortId(id),
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
        parentShortId,
        path,
        links,
      };
    },
  });

  folio_create = $tool({
    description:
      "Create a new folio in a campaign — a markdown note that becomes part of the campaign's memory for AI agents. Provide `campaign` (id) or `campaign_name`. `content` is markdown. **Always set `summary`** — a 1-2 sentence (~200 chars) description of what the folio is for. It's the field other agents (and future calls of yours) read in `campaign_context` to decide whether to fetch the body. Without a summary, the index falls back to the title and orientation suffers. Reuse existing `tags` when possible (call `folio_tags` first); good tags make `folio_list` / `folio_search` calls precise.",
    title: "Create folio",
    annotations: {
      // not idempotent — repeated calls create duplicate folios
    },
    schema: {
      params: t.object({
        campaign: t.optional(t.integer()),
        campaign_name: t.optional(t.string()),
        title: t.string({ minLength: 1, maxLength: 200 }),
        content: t.optional(t.string()),
        tags: t.optional(t.array(t.string())),
        summary: t.optional(
          t.string({
            maxLength: 500,
            description:
              "1-2 sentence description of what the folio is for. Surfaced via `campaign_context`. Strongly recommended — without it, agents must fetch the body to orient.",
          }),
        ),
        parent_shortId: t.optional(
          t.integer({
            description:
              "Nest under another folio in the same campaign by its per-campaign shortId. Omit (or pass nothing) to create at the root. Folio nesting is capped at 5 levels.",
          }),
        ),
      }),
      result: folioFullSchema,
    },
    handler: async ({ params }) => {
      const campaignId = await this.resolveCampaignId(
        params.campaign,
        params.campaign_name,
      );
      const parentId =
        params.parent_shortId !== undefined
          ? await this.resolveParentRef({
              parent_shortId: params.parent_shortId,
              campaign: campaignId,
            })
          : undefined;
      const folio = await this.folioController.create({
        body: {
          campaignId,
          title: params.title,
          content: params.content,
          tags: params.tags,
          summary: params.summary,
          parentId: parentId ?? undefined,
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
    annotations: {
      idempotentHint: true,
    },
    schema: {
      params: t.extend(folioRefParamsSchema, {
        title: t.optional(t.string({ minLength: 1, maxLength: 200 })),
        content: t.optional(t.string()),
        tags: t.optional(t.array(t.string())),
        summary: t.optional(
          t.string({
            maxLength: 500,
            description:
              "Updated 1-2 sentence description. Omit to keep the existing one.",
          }),
        ),
        parent_shortId: t.optional(
          t.integer({
            description:
              "Reparent the folio to the folio with this per-campaign shortId. Omit to leave the parent untouched. Pass 0 to lift the folio to the root.",
          }),
        ),
      }),
      result: folioFullSchema,
    },
    handler: async ({ params }) => {
      const id = await this.resolveFolioId(params);
      // 0 is the sentinel for "move to root" since shortId is 1-based and
      // JSON-Schema can't easily express null on optional integers.
      let parentId: string | null | undefined;
      if (params.parent_shortId === 0) {
        parentId = null;
      } else if (params.parent_shortId !== undefined) {
        parentId = await this.resolveParentRef({
          parent_shortId: params.parent_shortId,
          campaign: params.campaign,
          campaign_name: params.campaign_name,
        });
      }
      const folio = await this.folioController.update({
        params: { id },
        body: {
          title: params.title,
          content: params.content,
          tags: params.tags,
          summary: params.summary,
          parentId,
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

  folio_delete = $tool({
    description: "Delete a folio. This cannot be undone.",
    title: "Delete folio",
    annotations: {
      destructiveHint: true,
      idempotentHint: true, // deleting an already-deleted folio is a no-op
    },
    schema: {
      params: folioRefParamsSchema,
      result: t.object({ ok: t.boolean() }),
    },
    handler: async ({ params }) => {
      const id = await this.resolveFolioId(params);
      await this.folioController.delete({ params: { id } });
      return { ok: true };
    },
  });
}
