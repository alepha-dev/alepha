import { t } from "alepha";
import { $logger } from "alepha/logger";
import { $repository } from "alepha/orm";
import { $secure } from "alepha/security";
import {
  $action,
  ForbiddenError,
  NotFoundError,
  okSchema,
} from "alepha/server";
import { buildFolioSearchText, folios } from "../entities/folios.ts";

const idParamsSchema = t.object({ id: t.uuid() });

const folioListQuerySchema = t.object({
  limit: t.optional(t.integer({ minimum: 1, maximum: 100, default: 50 })),
  offset: t.optional(t.integer({ minimum: 0, default: 0 })),
  tag: t.optional(t.string()),
  q: t.optional(t.string()),
  campaignId: t.optional(t.integer()),
});

const tagListQuerySchema = t.object({
  campaignId: t.optional(t.integer()),
});

export class FolioController {
  log = $logger();
  folios = $repository(folios);

  /**
   * List the user's folios. Optional `q` runs a `LIKE %q%` over `searchText`
   * and `tag` filters by the (jsonb-encoded) tags array — both delegated to
   * the repository's filter operators.
   */
  list = $action({
    use: [$secure({ permissions: ["folio:read"] })],
    description: "List the current user's folios (newest first).",
    schema: {
      query: folioListQuerySchema,
      response: t.array(folios.schema),
    },
    handler: async ({ query, user }) => {
      const where: Record<string, unknown> = { userId: { eq: user.id } };
      if (query.campaignId !== undefined) {
        where.campaignId = { eq: query.campaignId };
      }
      if (query.q) {
        where.searchText = { like: `%${query.q.toLowerCase()}%` };
      }
      if (query.tag) {
        where.tags = { like: `%"${query.tag}"%` };
      }
      return this.folios.findMany({
        where,
        orderBy: [{ column: "updatedAt", direction: "desc" }],
        limit: query.limit ?? 50,
        offset: query.offset ?? 0,
      });
    },
  });

  /**
   * Distinct tag list for the current user, used by the sidebar tag cloud
   * and the chip-style tag autocomplete in the editor.
   */
  listTags = $action({
    use: [$secure({ permissions: ["folio:read"] })],
    description: "Return the distinct set of tags used by the current user.",
    schema: {
      query: tagListQuerySchema,
      response: t.array(t.string()),
    },
    handler: async ({ query, user }) => {
      const where: Record<string, unknown> = { userId: { eq: user.id } };
      if (query.campaignId !== undefined) {
        where.campaignId = { eq: query.campaignId };
      }
      const rows = await this.folios.findMany({
        where,
        columns: ["tags"],
      });
      const tags = new Set<string>();
      for (const row of rows) {
        for (const tag of row.tags ?? []) tags.add(tag);
      }
      return [...tags].sort();
    },
  });

  get = $action({
    use: [$secure({ permissions: ["folio:read"] })],
    description: "Get a single folio by id.",
    schema: {
      params: idParamsSchema,
      response: folios.schema,
    },
    handler: async ({ params, user }) => {
      const folio = await this.folios.findOne({
        where: { id: { eq: params.id } },
      });
      if (!folio) throw new NotFoundError("Folio not found");
      if (folio.userId !== user.id) throw new ForbiddenError();
      return folio;
    },
  });

  create = $action({
    use: [$secure({ permissions: ["folio:write"] })],
    description: "Create a new folio.",
    schema: {
      body: t.object({
        title: t.string({ minLength: 1, maxLength: 200 }),
        content: t.optional(t.string()),
        tags: t.optional(t.array(t.string())),
        campaignId: t.integer(),
      }),
      response: folios.schema,
    },
    handler: async ({ body, user }) => {
      const tags = (body.tags ?? []).map((t) => t.trim()).filter(Boolean);
      return this.folios.create({
        userId: user.id,
        campaignId: body.campaignId,
        title: body.title,
        content: body.content ?? "",
        tags,
        searchText: buildFolioSearchText({
          title: body.title,
          tags,
          content: body.content ?? "",
        }),
      });
    },
  });

  update = $action({
    use: [$secure({ permissions: ["folio:write"] })],
    description: "Update a folio.",
    schema: {
      params: idParamsSchema,
      body: t.object({
        title: t.optional(t.string({ minLength: 1, maxLength: 200 })),
        content: t.optional(t.string()),
        tags: t.optional(t.array(t.string())),
      }),
      response: folios.schema,
    },
    handler: async ({ params, body, user }) => {
      const existing = await this.folios.findOne({
        where: { id: { eq: params.id } },
      });
      if (!existing) throw new NotFoundError("Folio not found");
      if (existing.userId !== user.id) throw new ForbiddenError();

      const title = body.title ?? existing.title;
      const content = body.content ?? existing.content;
      const tags = body.tags
        ? body.tags.map((t) => t.trim()).filter(Boolean)
        : existing.tags;

      return this.folios.updateById(params.id, {
        title,
        content,
        tags,
        searchText: buildFolioSearchText({ title, tags, content }),
      });
    },
  });

  delete = $action({
    use: [$secure({ permissions: ["folio:write"] })],
    description: "Delete a folio.",
    schema: {
      params: idParamsSchema,
      response: okSchema,
    },
    handler: async ({ params, user }) => {
      const existing = await this.folios.findOne({
        where: { id: { eq: params.id } },
      });
      if (!existing) throw new NotFoundError("Folio not found");
      if (existing.userId !== user.id) throw new ForbiddenError();
      await this.folios.deleteById(params.id);
      return { ok: true };
    },
  });
}
