import { $inject, t } from "alepha";
import { $tool } from "alepha/mcp";
import { BadRequestError, NotFoundError } from "alepha/server";
import { CampaignController } from "../../api/controllers/CampaignController.ts";
import { FolioController } from "../../api/controllers/FolioController.ts";

const folioRefSchema = t.object({
  id: t.uuid(),
  title: t.string(),
  tags: t.array(t.string()),
  updatedAt: t.string(),
});

const folioFullSchema = t.object({
  id: t.uuid(),
  title: t.string(),
  tags: t.array(t.string()),
  content: t.string(),
  createdAt: t.string(),
  updatedAt: t.string(),
});

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
 * MCP tools for Folios — personal markdown notes.
 *
 * Designed for AI-first workflows: `folio_search` returns a snippet so the
 * model can disambiguate without a follow-up read; `folio_create` /
 * `folio_update` accept tags as a flat string array; all writes are scoped
 * to the authenticated user.
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

  folio_list = $tool({
    description:
      "List the user's folios (personal markdown notes), newest first. Use `tag` to narrow by a tag. Returns id, title, tags, updatedAt — call folio_get to read full content.",
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
          title: f.title,
          tags: f.tags,
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
      "Get the full content of a folio by id (markdown). Use folio_search or folio_list to find the id first.",
    title: "Get folio",
    annotations: {
      readOnlyHint: true,
      idempotentHint: true,
    },
    schema: {
      params: t.object({ id: t.uuid() }),
      result: folioFullSchema,
    },
    handler: async ({ params }) => {
      const folio = await this.folioController.get({
        params: { id: params.id },
      });
      return {
        id: folio.id,
        title: folio.title,
        tags: folio.tags,
        content: folio.content,
        createdAt: folio.createdAt,
        updatedAt: folio.updatedAt,
      };
    },
  });

  folio_create = $tool({
    description:
      "Create a new folio scoped to a campaign. Provide `campaign` (id) or `campaign_name`. `content` is markdown. `tags` should reuse existing tags when possible (call folio_tags to list them).",
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
      }),
      result: folioFullSchema,
    },
    handler: async ({ params }) => {
      const campaignId = await this.resolveCampaignId(
        params.campaign,
        params.campaign_name,
      );
      const folio = await this.folioController.create({
        body: {
          campaignId,
          title: params.title,
          content: params.content,
          tags: params.tags,
        },
      });
      return {
        id: folio.id,
        title: folio.title,
        tags: folio.tags,
        content: folio.content,
        createdAt: folio.createdAt,
        updatedAt: folio.updatedAt,
      };
    },
  });

  folio_update = $tool({
    description:
      "Update a folio. Any omitted field stays unchanged. Pass the full new tag array (it replaces the existing one).",
    title: "Update folio",
    annotations: {
      idempotentHint: true,
    },
    schema: {
      params: t.object({
        id: t.uuid(),
        title: t.optional(t.string({ minLength: 1, maxLength: 200 })),
        content: t.optional(t.string()),
        tags: t.optional(t.array(t.string())),
      }),
      result: folioFullSchema,
    },
    handler: async ({ params }) => {
      const folio = await this.folioController.update({
        params: { id: params.id },
        body: {
          title: params.title,
          content: params.content,
          tags: params.tags,
        },
      });
      return {
        id: folio.id,
        title: folio.title,
        tags: folio.tags,
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
      params: t.object({ id: t.uuid() }),
      result: t.object({ ok: t.boolean() }),
    },
    handler: async ({ params }) => {
      await this.folioController.delete({ params: { id: params.id } });
      return { ok: true };
    },
  });
}
