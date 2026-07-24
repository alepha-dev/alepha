import { $inject, z } from "alepha";
import { users } from "alepha/api/users";
import { $logger } from "alepha/logger";
import { $repository, $sequence, $transactional } from "alepha/orm";
import { $secure } from "alepha/security";
import {
  $action,
  BadRequestError,
  NotFoundError,
  okSchema,
} from "alepha/server";
import { archiveBlobs } from "../entities/archiveBlobs.ts";
import { archiveDirectories } from "../entities/archiveDirectories.ts";
import { campaigns } from "../entities/campaigns.ts";
import { characters } from "../entities/characters.ts";
import { folioRevisions } from "../entities/folioRevisions.ts";
import { buildFolioSearchText, folios } from "../entities/folios.ts";
import { AppSecurityProvider } from "../providers/AppSecurityProvider.ts";
import {
  folioLinksSchema,
  folioResourceSchema,
} from "../schemas/folioResourceSchema.ts";
import { AchievementEngine } from "../services/AchievementEngine.ts";
import {
  decideRevisionAction,
  FolioHistoryService,
} from "../services/FolioHistoryService.ts";
import { FolioLinkService } from "../services/FolioLinkService.ts";

const idParamsSchema = z.object({ id: z.uuid() });

const folioListQuerySchema = z.object({
  limit: z.integer().min(1).max(100).default(50).optional(),
  offset: z.integer().min(0).default(0).optional(),
  tag: z.string().optional(),
  q: z.string().optional(),
  campaignId: z.integer(),
});

const tagListQuerySchema = z.object({
  campaignId: z.integer(),
});

export class FolioController {
  log = $logger();
  folios = $repository(folios);
  protected readonly campaigns = $repository(campaigns);
  protected readonly characters = $repository(characters);
  protected readonly directories = $repository(archiveDirectories);
  protected readonly blobs = $repository(archiveBlobs);
  protected readonly revisions = $repository(folioRevisions);
  protected readonly users = $repository(users);
  protected readonly linkService = $inject(FolioLinkService);
  protected readonly historyService = $inject(FolioHistoryService);
  protected readonly security = $inject(AppSecurityProvider);
  protected readonly achievements = $inject(AchievementEngine);

  /**
   * Per-campaign sequence for `folios.shortId`. Powers the human-friendly
   * `/c/:campaignId/folios/:shortId` URL.
   */
  protected folioShortId = $sequence();

  /**
   * List folios in a campaign (campaign-shared — any member sees every
   * folio). Optional `q` runs `LIKE %q%` over `searchText`; `tag` filters
   * by the jsonb-encoded tags array.
   */
  list = $action({
    use: [$secure({ permissions: ["folio:read"] })],
    description: "List the campaign's folios (newest first).",
    schema: {
      query: folioListQuerySchema,
      response: z.array(folios.schema),
    },
    handler: async ({ query, user }) => {
      await this.security.assertMember(query.campaignId, user);
      const where: Record<string, unknown> = {
        campaignId: { eq: query.campaignId },
      };
      if (query.q) {
        where.searchText = { like: `%${query.q.toLowerCase()}%` };
      }
      if (query.tag) {
        where.tags = { like: `%"${query.tag}"%` };
      }
      return this.folios.findMany({
        where,
        orderBy: [
          { column: "pinned", direction: "desc" },
          { column: "updatedAt", direction: "desc" },
        ],
        limit: query.limit ?? 50,
        offset: query.offset ?? 0,
      });
    },
  });

  /**
   * Distinct tag list for the campaign, used by the sidebar tag cloud and
   * the chip-style tag autocomplete in the editor.
   */
  listTags = $action({
    use: [$secure({ permissions: ["folio:read"] })],
    description: "Return the distinct set of tags used in the campaign.",
    schema: {
      query: tagListQuerySchema,
      response: z.array(z.string()),
    },
    handler: async ({ query, user }) => {
      await this.security.assertMember(query.campaignId, user);
      const rows = await this.folios.findMany({
        where: { campaignId: { eq: query.campaignId } },
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
      params: z.object({
        campaignId: z.integer(),
        shortId: z.integer(),
      }),
      // `withLinks=true` attaches the resolved [[wiki-link]] index in
      // the same response. `withPath=true` attaches the folio's
      // directory chain (root → … → direct parent) — used by the
      // Archive UI to render the AppShell breadcrumb without a
      // separate `listAllDirectories` round-trip.
      query: z.object({
        withLinks: z.boolean().optional(),
        withPath: z.boolean().optional(),
      }),
      response: folioResourceSchema,
    },
    handler: async ({ params, query, user }) => {
      await this.security.assertMember(params.campaignId, user);
      const folio = await this.folios.findOne({
        where: {
          campaignId: { eq: params.campaignId },
          shortId: { eq: params.shortId },
        },
      });
      if (!folio) throw new NotFoundError("Folio not found");
      if (!query.withLinks && !query.withPath) return folio;
      const metadata: {
        links?: Awaited<ReturnType<FolioController["resolveLinks"]>>;
        path?: { shortId: number; name: string }[];
      } = {};
      if (query.withLinks) {
        metadata.links = await this.resolveLinks(folio.id);
      }
      if (query.withPath) {
        metadata.path = await this.resolveDirectoryPath(folio.directoryId);
      }
      return { ...folio, metadata };
    },
  });

  /**
   * Walk the archive-directory chain from `directoryId` up to the root.
   * Returns `[root, ..., directParent]` — empty when the folio lives at
   * the campaign root. Bounded by `archiveDirectories` depth-cap (8).
   */
  protected async resolveDirectoryPath(
    directoryId: string | undefined,
  ): Promise<{ shortId: number; name: string }[]> {
    const chain: { shortId: number; name: string }[] = [];
    let cursor: string | undefined = directoryId;
    const seen = new Set<string>();
    while (cursor && !seen.has(cursor)) {
      seen.add(cursor);
      const dir = (await this.directories.findOne({
        where: { id: { eq: cursor } },
      })) as { shortId: number; name: string; parentId?: string } | undefined;
      if (!dir) break;
      chain.unshift({ shortId: dir.shortId, name: dir.name });
      cursor = dir.parentId;
    }
    return chain;
  }

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
      await this.security.assertMember(folio.campaignId, user);
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
      response: folioLinksSchema,
    },
    handler: async ({ params, user }) => {
      const folio = await this.folios.findOne({
        where: { id: { eq: params.id } },
      });
      if (!folio) throw new NotFoundError("Folio not found");
      await this.security.assertMember(folio.campaignId, user);
      return this.resolveLinks(folio.id);
    },
  });

  /**
   * Resolve outbound + inbound `[[wiki-link]]` refs for a folio into
   * `{ kind, shortId, title }` pairs. Caller is responsible for the
   * membership check on the folio itself.
   */
  protected async resolveLinks(folioId: string) {
    const [out, inb] = await Promise.all([
      this.linkService.findOutbound(folioId),
      this.linkService.findInbound(folioId),
    ]);

    // Outbound: split by targetType. Folio + quest + blob each resolve
    // through their own table. Old rows have no targetType (defaults
    // to "folio"), so the partition stays backwards-compatible.
    const outFolioIds = out
      .filter((l) => l.targetType === "folio")
      .map((l) => l.toId);
    const outQuestIds = out
      .filter((l) => l.targetType === "quest")
      .map((l) => Number.parseInt(l.toId, 10))
      .filter((n) => Number.isFinite(n));
    const outBlobIds = out
      .filter((l) => l.targetType === "blob")
      .map((l) => l.toId);

    const [folioRefs, questRefs, blobRefs, inboundRefs] = await Promise.all([
      outFolioIds.length > 0
        ? this.folios.findMany({
            where: { id: { inArray: outFolioIds } },
            columns: ["id", "shortId", "title", "directoryId", "campaignId"],
          })
        : Promise.resolve([]),
      outQuestIds.length > 0
        ? this.linkService.findQuestRefs(outQuestIds)
        : Promise.resolve([]),
      outBlobIds.length > 0
        ? this.blobs.findMany({
            where: { fileId: { inArray: outBlobIds } },
            columns: ["fileId", "shortId", "name", "directoryId", "campaignId"],
          })
        : Promise.resolve([]),
      inb.length > 0
        ? this.folios.findMany({
            where: { id: { inArray: inb.map((l) => l.fromId) } },
            columns: ["id", "shortId", "title", "directoryId", "campaignId"],
          })
        : Promise.resolve([]),
    ]);

    // Build a single per-campaign directory map up front. All linked
    // folios + blobs share the source's campaign (link rows are
    // tenant-scoped via folio_id), so one fetch covers every ref's
    // ancestor walk and avoids N+1 findOne calls per directory.
    const campaignIds = new Set<number>();
    for (const f of folioRefs) campaignIds.add(f.campaignId);
    for (const b of blobRefs) campaignIds.add(b.campaignId);
    for (const f of inboundRefs) campaignIds.add(f.campaignId);
    const dirRows = campaignIds.size
      ? await this.directories.findMany({
          where: { campaignId: { inArray: [...campaignIds] } },
          columns: ["id", "shortId", "name", "parentId"],
        })
      : [];
    const dirById = new Map(dirRows.map((d) => [d.id, d]));
    const pathOf = (
      directoryId: string | undefined | null,
    ): { shortId: number; name: string }[] | undefined => {
      if (!directoryId) return undefined;
      const chain: { shortId: number; name: string }[] = [];
      let cursor: string | undefined = directoryId;
      const seen = new Set<string>();
      while (cursor && !seen.has(cursor)) {
        seen.add(cursor);
        const dir = dirById.get(cursor);
        if (!dir) break;
        chain.unshift({ shortId: dir.shortId, name: dir.name });
        cursor = dir.parentId;
      }
      return chain.length ? chain : undefined;
    };

    const folioById = new Map(folioRefs.map((r) => [r.id, r]));
    const questById = new Map(questRefs.map((r) => [r.id, r]));
    const blobById = new Map(blobRefs.map((r) => [r.fileId, r]));
    const inboundById = new Map(inboundRefs.map((r) => [r.id, r]));

    type OutRef = {
      kind: "folio" | "quest" | "blob";
      shortId: number;
      title: string;
      path?: { shortId: number; name: string }[];
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
      } else if (l.targetType === "blob") {
        const ref = blobById.get(l.toId);
        if (ref)
          outbound.push({
            kind: "blob",
            shortId: ref.shortId,
            title: ref.name,
            path: pathOf(ref.directoryId),
          });
      } else {
        const ref = folioById.get(l.toId);
        if (ref)
          outbound.push({
            kind: "folio",
            shortId: ref.shortId,
            title: ref.title,
            path: pathOf(ref.directoryId),
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
                path: pathOf(ref.directoryId),
              },
            ]
          : [];
      }),
    };
  }

  /**
   * Resolve a `directoryId` body input. Verifies the directory exists
   * in the same campaign and returns the canonical UUID. `null` /
   * `undefined` → root (returns `undefined`).
   *
   * Cross-type name uniqueness (folio vs blob vs other-folio in the
   * same directory) is enforced separately via the `archive_names`
   * reservation table — see `ArchiveDirectoryService` (Phase B).
   */
  protected async resolveDirectoryId(
    directoryId: string | null | undefined,
    campaignId: number,
  ): Promise<string | undefined> {
    if (directoryId === null || directoryId === undefined) return undefined;
    const directory = await this.directories.findOne({
      where: {
        id: { eq: directoryId },
        campaignId: { eq: campaignId },
      },
    });
    if (!directory) {
      throw new BadRequestError("Directory not found in this campaign");
    }
    return directory.id;
  }

  create = $action({
    use: [$secure({ permissions: ["folio:write"] }), $transactional()],
    description: "Create a new folio.",
    schema: {
      body: z.object({
        title: z.string().min(1).max(200),
        content: z.string().optional(),
        tags: z.array(z.string()).optional(),
        summary: z.string().max(500).optional(),
        campaignId: z.integer(),
        /**
         * Archive directory the folio lives in. `null` / omitted →
         * campaign root. See quest [[#66]] — folios no longer nest in
         * other folios, they sit in archive directories.
         */
        directoryId: z.uuid().nullable().optional(),
        /**
         * When true the body's `content` is a `BrowserCryptoProvider`
         * envelope. The server doesn't try to inspect it; we just skip
         * the `searchText` indexing so we don't leak a hash of the
         * plaintext through LIKE matches.
         */
        protected: z.boolean().optional(),
        /** Pin the folio on creation. Defaults to false. */
        pinned: z.boolean().optional(),
      }),
      response: folios.schema,
    },
    handler: async ({ body, user }) => {
      await this.security.assertMember(body.campaignId, user);
      const tags = (body.tags ?? []).map((t) => t.trim()).filter(Boolean);
      const summary = (body.summary ?? "").trim();
      const content = body.content ?? "";
      const isProtected = body.protected === true;
      const pinned = body.pinned === true;
      const directoryId = await this.resolveDirectoryId(
        body.directoryId,
        body.campaignId,
      );
      const shortId = await this.folioShortId.next(String(body.campaignId));
      const folio = await this.folios.create({
        campaignId: body.campaignId,
        shortId,
        title: body.title,
        content,
        tags,
        summary,
        directoryId,
        protected: isProtected,
        pinned,
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
      // Seed the revision log with a `create` entry. Snapshot is the
      // folio as it stands right after insert — gives the History tab a
      // baseline to diff later edits against.
      await this.historyService.appendRevision(folio, user.id, "create");

      // Achievement hook: bookkeeper triggers when the campaign reaches
      // its 5th folio. Best-effort — a failure here must not undo the
      // folio insert.
      try {
        const character = await this.characters.findOne({
          where: {
            campaignId: { eq: body.campaignId },
            userId: { eq: user.id },
          },
        });
        if (character) {
          const campaign = await this.campaigns.getOne({
            where: { id: { eq: body.campaignId } },
          });
          const granted = await this.achievements.evaluate(
            { type: "folio.saved" },
            {
              character,
              campaignZones: campaign.zones ?? [],
            },
          );
          if (granted.length > 0) {
            character.achievements = this.achievements.grant(
              character,
              granted,
            );
            await this.characters.save(character);
          }
        }
      } catch (err) {
        this.log.warn(`achievement hook (folio.saved) failed: ${String(err)}`);
      }

      return folio;
    },
  });

  update = $action({
    use: [$secure({ permissions: ["folio:write"] }), $transactional()],
    description: "Update a folio.",
    schema: {
      params: idParamsSchema,
      body: z.object({
        title: z.string().min(1).max(200).optional(),
        content: z.string().optional(),
        tags: z.array(z.string()).optional(),
        summary: z.string().max(500).optional(),
        /**
         * Move the folio to a different archive directory. `null` →
         * campaign root; `undefined` → leave untouched.
         */
        directoryId: z.uuid().nullable().optional(),
        /**
         * Toggle protected state. Caller is responsible for sending the
         * new `content` shape that matches (plaintext markdown when
         * false, crypto envelope when true).
         */
        protected: z.boolean().optional(),
        /** Pin/unpin the folio. Omitted leaves the current state. */
        pinned: z.boolean().optional(),
      }),
      response: folios.schema,
    },
    handler: async ({ params, body, user }) => {
      const existing = await this.folios.findOne({
        where: { id: { eq: params.id } },
      });
      if (!existing) throw new NotFoundError("Folio not found");
      await this.security.assertMember(existing.campaignId, user);

      const title = body.title ?? existing.title;
      const content = body.content ?? existing.content;
      const tags = body.tags
        ? body.tags.map((t) => t.trim()).filter(Boolean)
        : existing.tags;
      const summary =
        body.summary !== undefined ? body.summary.trim() : existing.summary;

      // `null` from the caller = "explicit move to campaign root" — must
      // be propagated to `updateById` as `null` so Drizzle writes NULL.
      // `undefined` would be silently dropped by the ORM update layer,
      // leaving the folio stuck in its current directory (regression
      // hit while moving the Club Glossary to root — Alepha treats
      // `undefined` as "no change" but `null` as "set NULL").
      let directoryId: string | null | undefined = existing.directoryId;
      if ("directoryId" in body) {
        if (body.directoryId === null) {
          directoryId = null;
        } else {
          directoryId = await this.resolveDirectoryId(
            body.directoryId,
            existing.campaignId,
          );
        }
      }

      const isProtected =
        body.protected !== undefined ? body.protected : existing.protected;
      const pinned = body.pinned !== undefined ? body.pinned : existing.pinned;

      const updated = await this.folios.updateById(params.id, {
        title,
        content,
        tags,
        summary,
        directoryId,
        protected: isProtected,
        pinned,
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
      } else if (!existing.protected) {
        // clear → protected (the view's Encrypt action): the plaintext —
        // and the `[[links]]` parsed from it — is now ciphertext. Wipe the
        // outbound links so the graph doesn't leak what the folio used to
        // reference. `searchText` is already blanked above.
        await this.linkService.syncLinks(updated, "");
      }
      // Crossing the protection boundary invalidates every stored snapshot:
      // they belong to the previous cryptographic domain. Purge BEFORE
      // appending below, so the revision written for THIS edit (already in
      // the new domain) survives. Going clear → protected this is the
      // confidentiality fix — without it, encrypting a folio left every
      // pre-encryption plaintext snapshot readable by any campaign member
      // through `listHistory`.
      if (isProtected !== existing.protected) {
        await this.historyService.purgeRevisions(params.id);
      }

      // Write a revision row when the change touched anything we record
      // (content / title / tags / summary). Pin-only or
      // parent-reparent-only updates skip the revision — they're not
      // edits in the spec's sense.
      const action = decideRevisionAction(
        {
          title: existing.title,
          content: existing.content,
          tags: existing.tags,
          summary: existing.summary,
        },
        { title, content, tags, summary },
      );
      if (action) {
        await this.historyService.appendRevision(updated, user.id, action);
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
      await this.security.assertMember(existing.campaignId, user);
      // Folios no longer have folio children since quest #66 — they're
      // leaves under archive directories. So a plain delete is enough;
      // folio_links + folio_revisions cascade via their FKs.
      await this.folios.deleteById(params.id);
      return { ok: true };
    },
  });

  // ---------------------------------------------------------------------------
  // History — Chronicles of the Folio (#63)
  // ---------------------------------------------------------------------------

  /**
   * Cross-folio activity feed for a campaign — used by the Archive
   * "Recent activity" panel (Lore #105). Joins `folio_revisions` to
   * `folios` to scope by campaign, batches user-metadata resolution,
   * caps at 50 rows by construction.
   *
   * Bounded by the per-folio retention cap × folio count, so no cursor
   * pagination in v1. Revisit if this query shows up in slow-query
   * telemetry.
   */
  listCampaignActivity = $action({
    use: [$secure({ permissions: ["folio:read"] })],
    path: "/folios/activity",
    description:
      "Recent folio activity in a campaign (revisions across all folios, newest first).",
    schema: {
      query: z.object({
        campaignId: z.integer(),
        limit: z.integer().min(1).max(100).optional(),
      }),
      response: z.object({
        items: z.array(
          z.object({
            id: z.uuid(),
            at: z.string(),
            action: z
              .enum(["create", "edit", "rename", "tag-change", "revert"])
              .meta({ mode: "text" }),
            byUserId: z.uuid().optional(),
            byUsername: z.string().optional(),
            byAvatarUrl: z.string().optional(),
            folioId: z.uuid(),
            folioShortId: z.integer(),
            folioTitle: z.string(),
          }),
        ),
      }),
    },
    handler: async ({ query, user }) => {
      await this.security.assertMember(query.campaignId, user);
      const limit = query.limit ?? 50;

      // Folio set for this campaign — small per campaign, so one fetch
      // + in-memory join is cheaper than a SQL join through Drizzle's
      // query builder (and keeps the repository abstraction).
      const campaignFolios = await this.folios.findMany({
        where: { campaignId: { eq: query.campaignId } },
        columns: ["id", "shortId", "title"],
      });
      if (campaignFolios.length === 0) return { items: [] };
      const folioById = new Map(campaignFolios.map((f) => [f.id, f]));

      const revisions = await this.revisions.findMany({
        where: { folioId: { inArray: campaignFolios.map((f) => f.id) } },
        orderBy: [{ column: "at", direction: "desc" }],
        limit,
      });

      // Batched user lookup — mirrors QuestJobs.sendDueReminders' pattern.
      const distinctUserIds = [
        ...new Set(revisions.flatMap((r) => (r.byUserId ? [r.byUserId] : []))),
      ];
      const userRows =
        distinctUserIds.length > 0
          ? await this.users.findMany({
              where: { id: { inArray: distinctUserIds } },
              columns: ["id", "username", "email", "picture"],
            })
          : [];
      const userById = new Map(userRows.map((u) => [u.id, u]));

      return {
        items: revisions.map((r) => {
          const folio = folioById.get(r.folioId);
          const u = r.byUserId ? userById.get(r.byUserId) : undefined;
          return {
            id: r.id,
            at: r.at,
            action: r.action,
            byUserId: r.byUserId,
            byUsername: u?.username ?? u?.email,
            byAvatarUrl: u?.picture ? `/api/files/${u.picture}` : undefined,
            folioId: r.folioId,
            folioShortId: folio?.shortId ?? 0,
            folioTitle: folio?.title ?? "",
          };
        }),
      };
    },
  });

  /**
   * List revisions for a folio, newest first. Capped at
   * `folioHistoryAtom.maxRevisions` (default 10) by construction, so no
   * pagination here.
   */
  listHistory = $action({
    use: [$secure({ permissions: ["folio:read"] })],
    path: "/folios/:id/history",
    description: "List the revision history of a folio (newest first).",
    schema: {
      params: idParamsSchema,
      response: z.array(folioRevisions.schema),
    },
    handler: async ({ params, user }) => {
      const folio = await this.folios.findOne({
        where: { id: { eq: params.id } },
      });
      if (!folio) throw new NotFoundError("Folio not found");
      await this.security.assertMember(folio.campaignId, user);
      return this.historyService.listRevisions(folio.id);
    },
  });

  /**
   * Revert a folio to a prior revision. Doesn't truly rewind — it
   * creates a NEW revision (`action: "revert"`) with the prior
   * content, so the "corrupted" version stays in history and the user
   * can undo the revert if they did it in error.
   */
  revertHistory = $action({
    use: [$secure({ permissions: ["folio:write"] }), $transactional()],
    path: "/folios/:id/history/:revisionId/revert",
    description: "Revert a folio to a prior revision (creates a new revision).",
    schema: {
      params: z.object({
        id: z.uuid(),
        revisionId: z.uuid(),
      }),
      response: folios.schema,
    },
    handler: async ({ params, user }) => {
      const folio = await this.folios.findOne({
        where: { id: { eq: params.id } },
      });
      if (!folio) throw new NotFoundError("Folio not found");
      await this.security.assertMember(folio.campaignId, user);

      const revision = await this.historyService.findRevision(
        params.revisionId,
      );
      if (!revision || revision.folioId !== folio.id) {
        throw new NotFoundError("Revision not found");
      }

      const isProtected = folio.protected;
      const updated = await this.folios.updateById(folio.id, {
        title: revision.titleSnapshot,
        content: revision.contentSnapshot,
        tags: revision.tagsSnapshot,
        summary: revision.summarySnapshot,
        searchText: isProtected
          ? ""
          : buildFolioSearchText({
              title: revision.titleSnapshot,
              tags: revision.tagsSnapshot,
              summary: revision.summarySnapshot,
              content: revision.contentSnapshot,
            }),
      });

      if (!isProtected) {
        await this.linkService.syncLinks(updated, revision.contentSnapshot);
      }
      await this.historyService.appendRevision(updated, user.id, "revert");
      return updated;
    },
  });

  /**
   * Toggle the `pinned` flag on a revision. Pinned revisions are
   * exempt from the inline retention sweep — they survive even when
   * older non-pinned revisions get dropped.
   */
  pinHistory = $action({
    use: [$secure({ permissions: ["folio:write"] })],
    path: "/folios/:id/history/:revisionId/pin",
    description: "Toggle pin on a folio revision.",
    schema: {
      params: z.object({
        id: z.uuid(),
        revisionId: z.uuid(),
      }),
      body: z.object({ pinned: z.boolean() }),
      response: okSchema,
    },
    handler: async ({ params, body, user }) => {
      const folio = await this.folios.findOne({
        where: { id: { eq: params.id } },
      });
      if (!folio) throw new NotFoundError("Folio not found");
      await this.security.assertMember(folio.campaignId, user);
      const revision = await this.historyService.findRevision(
        params.revisionId,
      );
      if (!revision || revision.folioId !== folio.id) {
        throw new NotFoundError("Revision not found");
      }
      await this.historyService.setPinned(revision.id, body.pinned);
      return { ok: true };
    },
  });
}
