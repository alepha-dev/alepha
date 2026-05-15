import { $inject, t } from "alepha";
import { $logger } from "alepha/logger";
import { $repository, $sequence, $transactional } from "alepha/orm";
import { $secure } from "alepha/security";
import {
  $action,
  BadRequestError,
  ForbiddenError,
  NotFoundError,
  okSchema,
} from "alepha/server";
import { buildFolioSearchText, folios } from "../entities/folios.ts";
import { FolioLinkService } from "../services/FolioLinkService.ts";

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
  protected readonly linkService = $inject(FolioLinkService);

  /**
   * Per-campaign sequence for `folios.shortId`. Powers the human-friendly
   * `/c/:campaignId/folios/:shortId` URL.
   */
  protected folioShortId = $sequence();

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

  getByShortId = $action({
    use: [$secure({ permissions: ["folio:read"] })],
    description: "Get a single folio by its per-campaign shortId.",
    path: "/campaigns/:campaignId/folios/:shortId",
    schema: {
      params: t.object({
        campaignId: t.integer(),
        shortId: t.integer(),
      }),
      response: folios.schema,
    },
    handler: async ({ params, user }) => {
      const folio = await this.folios.findOne({
        where: {
          campaignId: { eq: params.campaignId },
          shortId: { eq: params.shortId },
        },
      });
      if (!folio) throw new NotFoundError("Folio not found");
      if (folio.userId !== user.id) throw new ForbiddenError();
      return folio;
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

  /**
   * Return the resolved outbound + inbound `[[wiki-link]]` refs for a
   * folio, as `{ shortId, title }` pairs ready for display. Separate from
   * `get` so the latter's existing `folios.schema` response stays stable;
   * MCP `folio_get` calls both and merges.
   */
  getLinks = $action({
    use: [$secure({ permissions: ["folio:read"] })],
    description: "Get wiki-link outbound + inbound refs for a folio.",
    schema: {
      params: idParamsSchema,
      response: t.object({
        outbound: t.array(
          t.object({
            kind: t.enum(["folio", "quest"]),
            shortId: t.integer(),
            title: t.string(),
          }),
        ),
        // Inbound is always folio→folio (only folios contain `[[...]]`).
        inbound: t.array(
          t.object({
            kind: t.enum(["folio"]),
            shortId: t.integer(),
            title: t.string(),
          }),
        ),
      }),
    },
    handler: async ({ params, user }) => {
      const folio = await this.folios.findOne({
        where: { id: { eq: params.id } },
      });
      if (!folio) throw new NotFoundError("Folio not found");
      if (folio.userId !== user.id) throw new ForbiddenError();

      const [out, inb] = await Promise.all([
        this.linkService.findOutbound(folio.id),
        this.linkService.findInbound(folio.id),
      ]);

      // Outbound: split by targetType. Folio targets resolve through
      // folios; quest targets through quests. Old rows have no
      // targetType (defaults to "folio"), so the partition stays
      // backwards-compatible.
      const outFolioIds = out
        .filter((l) => l.targetType === "folio")
        .map((l) => l.toId);
      const outQuestIds = out
        .filter((l) => l.targetType === "quest")
        .map((l) => Number.parseInt(l.toId, 10))
        .filter((n) => Number.isFinite(n));

      const [folioRefs, questRefs, inboundRefs] = await Promise.all([
        outFolioIds.length > 0
          ? this.folios.findMany({
              where: { id: { inArray: outFolioIds } },
              columns: ["id", "shortId", "title"],
            })
          : Promise.resolve([]),
        outQuestIds.length > 0
          ? this.linkService.findQuestRefs(outQuestIds)
          : Promise.resolve([]),
        inb.length > 0
          ? this.folios.findMany({
              where: { id: { inArray: inb.map((l) => l.fromId) } },
              columns: ["id", "shortId", "title"],
            })
          : Promise.resolve([]),
      ]);

      const folioById = new Map(folioRefs.map((r) => [r.id, r]));
      const questById = new Map(questRefs.map((r) => [r.id, r]));
      const inboundById = new Map(inboundRefs.map((r) => [r.id, r]));

      type OutRef = {
        kind: "folio" | "quest";
        shortId: number;
        title: string;
      };
      const outbound: OutRef[] = [];
      for (const l of out) {
        if (l.targetType === "quest") {
          const ref = questById.get(Number.parseInt(l.toId, 10));
          if (ref)
            outbound.push({
              kind: "quest",
              shortId: ref.shortId,
              title: ref.title,
            });
        } else {
          const ref = folioById.get(l.toId);
          if (ref)
            outbound.push({
              kind: "folio",
              shortId: ref.shortId,
              title: ref.title,
            });
        }
      }
      return {
        outbound,
        inbound: inb.flatMap((l) => {
          const ref = inboundById.get(l.fromId);
          return ref
            ? [
                {
                  kind: "folio" as const,
                  shortId: ref.shortId,
                  title: ref.title,
                },
              ]
            : [];
        }),
      };
    },
  });

  /**
   * Hard cap on hierarchy depth — keeps the sidebar tree readable and
   * avoids galaxy-brain "/area/sub/sub/sub/sub/sub" nesting. A user who
   * really needs more can lift items to a sibling layer.
   */
  protected readonly MAX_FOLIO_DEPTH = 5;

  /**
   * Compute the chain from a folio up to its root, returning the path
   * array (excluding the input id). Throws if a cycle is detected (a
   * defensive guard — cycles should never persist, since {@link assertNoCycle}
   * runs at every parent change).
   */
  protected async resolveAncestors(
    startId: string,
    userId: string,
  ): Promise<string[]> {
    const chain: string[] = [];
    const seen = new Set<string>();
    let cursor: string | undefined = startId;
    while (cursor) {
      if (seen.has(cursor)) {
        throw new BadRequestError("Folio hierarchy has a cycle");
      }
      seen.add(cursor);
      const node = (await this.folios.findOne({
        where: { id: { eq: cursor }, userId: { eq: userId } },
      })) as { parentId?: string } | undefined;
      const nextParent: string | undefined = node?.parentId;
      if (!nextParent) break;
      chain.push(nextParent);
      cursor = nextParent;
    }
    return chain;
  }

  /**
   * Throw when setting `parentId` on `folioId` would either point the
   * folio at one of its own descendants (cycle) or push the subtree
   * beyond {@link MAX_FOLIO_DEPTH}. Caller is responsible for the
   * "parent exists in same campaign / same user" check via repository
   * filters; we only handle the structural rules here.
   */
  protected async assertNoCycle(
    folioId: string,
    parentId: string,
    userId: string,
  ): Promise<void> {
    if (folioId === parentId) {
      throw new BadRequestError("A folio cannot be its own parent");
    }
    const ancestors = await this.resolveAncestors(parentId, userId);
    if (ancestors.includes(folioId)) {
      throw new BadRequestError(
        "Cannot move a folio under one of its own descendants",
      );
    }
    // depth = ancestors of parent + parent itself + this folio
    if (ancestors.length + 2 > this.MAX_FOLIO_DEPTH) {
      throw new BadRequestError(
        `Folio nesting exceeds the limit (${this.MAX_FOLIO_DEPTH} levels)`,
      );
    }
  }

  create = $action({
    use: [$secure({ permissions: ["folio:write"] }), $transactional()],
    description: "Create a new folio.",
    schema: {
      body: t.object({
        title: t.string({ minLength: 1, maxLength: 200 }),
        content: t.optional(t.string()),
        tags: t.optional(t.array(t.string())),
        summary: t.optional(t.string({ maxLength: 500 })),
        campaignId: t.integer(),
        parentId: t.optional(t.nullable(t.uuid())),
        /**
         * When true the body's `content` is a `BrowserCryptoProvider`
         * envelope. The server doesn't try to inspect it; we just skip
         * the `searchText` indexing so we don't leak a hash of the
         * plaintext through LIKE matches.
         */
        protected: t.optional(t.boolean()),
      }),
      response: folios.schema,
    },
    handler: async ({ body, user }) => {
      const tags = (body.tags ?? []).map((t) => t.trim()).filter(Boolean);
      const summary = (body.summary ?? "").trim();
      const content = body.content ?? "";
      const isProtected = body.protected === true;
      // Parent must exist, belong to the same user + campaign. Depth
      // check piggybacks on resolveAncestors so we don't allow creating
      // a leaf that breaches MAX_FOLIO_DEPTH.
      let parentId: string | undefined;
      if (body.parentId) {
        const parent = await this.folios.findOne({
          where: {
            id: { eq: body.parentId },
            userId: { eq: user.id },
            campaignId: { eq: body.campaignId },
          },
        });
        if (!parent) {
          throw new BadRequestError("Parent folio not found in this campaign");
        }
        const ancestors = await this.resolveAncestors(body.parentId, user.id);
        if (ancestors.length + 2 > this.MAX_FOLIO_DEPTH) {
          throw new BadRequestError(
            `Folio nesting exceeds the limit (${this.MAX_FOLIO_DEPTH} levels)`,
          );
        }
        parentId = body.parentId;
      }
      const shortId = await this.folioShortId.next(String(body.campaignId));
      const folio = await this.folios.create({
        userId: user.id,
        campaignId: body.campaignId,
        shortId,
        title: body.title,
        content,
        tags,
        summary,
        parentId,
        protected: isProtected,
        searchText: isProtected
          ? // Search index intentionally blank for protected folios —
            // we can't index ciphertext, and we don't even leak the
            // summary into the search blob (the user may want it
            // sensitive too). Title still surfaces via the dedicated
            // title-LIKE path in the sidebar filter.
            ""
          : buildFolioSearchText({
              title: body.title,
              tags,
              summary,
              content,
            }),
      });
      // Sync outbound `[[...]]` references. Skipped for protected folios
      // since `content` is ciphertext — scanning it for `[[...]]` would
      // generate noisy junk links from base64 chars.
      if (!isProtected) {
        await this.linkService.syncLinks(folio, content);
      }
      return folio;
    },
  });

  update = $action({
    use: [$secure({ permissions: ["folio:write"] }), $transactional()],
    description: "Update a folio.",
    schema: {
      params: idParamsSchema,
      body: t.object({
        title: t.optional(t.string({ minLength: 1, maxLength: 200 })),
        content: t.optional(t.string()),
        tags: t.optional(t.array(t.string())),
        summary: t.optional(t.string({ maxLength: 500 })),
        /**
         * Reparent the folio. `null` moves it to the root; `undefined`
         * leaves the parent untouched. Validated for cycles and against
         * MAX_FOLIO_DEPTH.
         */
        parentId: t.optional(t.nullable(t.uuid())),
        /**
         * Toggle protected state. Caller is responsible for sending the
         * new `content` shape that matches (plaintext markdown when
         * false, crypto envelope when true).
         */
        protected: t.optional(t.boolean()),
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
      const summary =
        body.summary !== undefined ? body.summary.trim() : existing.summary;

      let parentId: string | undefined = existing.parentId;
      if ("parentId" in body) {
        if (body.parentId === null || body.parentId === undefined) {
          parentId = undefined;
        } else {
          const parent = await this.folios.findOne({
            where: {
              id: { eq: body.parentId },
              userId: { eq: user.id },
              campaignId: { eq: existing.campaignId },
            },
          });
          if (!parent) {
            throw new BadRequestError(
              "Parent folio not found in this campaign",
            );
          }
          await this.assertNoCycle(params.id, body.parentId, user.id);
          parentId = body.parentId;
        }
      }

      const isProtected =
        body.protected !== undefined ? body.protected : existing.protected;

      const updated = await this.folios.updateById(params.id, {
        title,
        content,
        tags,
        summary,
        parentId,
        protected: isProtected,
        searchText: isProtected
          ? ""
          : buildFolioSearchText({ title, tags, summary, content }),
      });
      // Re-sync outbound links whenever content changed. We re-sync even
      // when the content arg was omitted — title changes can render an
      // existing inbound `[[Old Title]]` from a *different* folio stale,
      // but those are owned by the other folio's row in folio_links so
      // they're picked up the next time THAT folio is edited. Cheap.
      if (!isProtected) {
        await this.linkService.syncLinks(updated, content);
      }
      return updated;
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
      // Orphan direct children to root before deletion so D1 doesn't
      // refuse the delete (no ON DELETE SET NULL on the ALTER-TABLE
      // generated FK). Single-level — grandchildren stay attached to
      // their parents which themselves move up one notch.
      const children = await this.folios.findMany({
        where: { parentId: { eq: params.id } },
        columns: ["id"],
      });
      for (const child of children) {
        await this.folios.updateById(child.id, { parentId: undefined });
      }
      await this.folios.deleteById(params.id);
      return { ok: true };
    },
  });
}
