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
import { folioBlobs } from "../entities/folioBlobs.ts";
import { folioDirectories } from "../entities/folioDirectories.ts";
import { folioRevisions } from "../entities/folioRevisions.ts";
import { buildFolioSearchText, folios } from "../entities/folios.ts";
import { projects } from "../entities/projects.ts";
import { relations } from "../relations.ts";
import {
  folioLinksSchema,
  folioResourceSchema,
} from "../schemas/folioResourceSchema.ts";
import { FolioBlobService } from "../services/FolioBlobService.ts";
import {
  decideRevisionAction,
  FolioHistoryService,
} from "../services/FolioHistoryService.ts";
import { FolioLinkService } from "../services/FolioLinkService.ts";
import { ProjectSecurityService } from "../services/ProjectSecurityService.ts";

const idParamsSchema = z.object({ id: z.uuid() });

const folioListQuerySchema = z.object({
  limit: z.integer().min(1).max(100).default(50).optional(),
  offset: z.integer().min(0).default(0).optional(),
  tag: z.string().optional(),
  q: z.string().optional(),
  projectId: z.integer(),
});

const tagListQuerySchema = z.object({
  projectId: z.integer(),
});

export class FolioController {
  log = $logger();
  folios = $repository(folios);
  protected readonly projects = $repository(projects);
  protected readonly directories = $repository(folioDirectories);
  protected readonly blobs = $repository(folioBlobs);
  protected readonly revisions = $repository(folioRevisions);
  /** ...with the author attached, for the project activity feed. */
  protected readonly revisionsWith = $repository(relations, "folioRevisions");
  protected readonly users = $repository(users);
  protected readonly linkService = $inject(FolioLinkService);
  protected readonly blobService = $inject(FolioBlobService);
  protected readonly historyService = $inject(FolioHistoryService);
  protected readonly security = $inject(ProjectSecurityService);

  /**
   * Per-project sequence for `folios.shortId`. Powers the human-friendly
   * `/p/:projectId/folios/:shortId` URL.
   */
  protected folioShortId = $sequence();

  /**
   * List folios in a project (project-shared — any member sees every
   * folio). Optional `q` runs `LIKE %q%` over `searchText`; `tag` filters
   * by the jsonb-encoded tags array.
   */
  list = $action({
    use: [$secure({ permissions: ["folio:read"] })],
    description: "List the project's folios (newest first).",
    schema: {
      query: folioListQuerySchema,
      response: z.array(folios.schema),
    },
    handler: async ({ query, user }) => {
      await this.security.assertMember(query.projectId, user);
      const where: Record<string, unknown> = {
        projectId: { eq: query.projectId },
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
   * Distinct tag list for the project, used by the sidebar tag cloud and
   * the chip-style tag autocomplete in the editor.
   */
  listTags = $action({
    use: [$secure({ permissions: ["folio:read"] })],
    description: "Return the distinct set of tags used in the project.",
    schema: {
      query: tagListQuerySchema,
      response: z.array(z.string()),
    },
    handler: async ({ query, user }) => {
      await this.security.assertMember(query.projectId, user);
      const rows = await this.folios.findMany({
        where: { projectId: { eq: query.projectId } },
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
    description: "Get a single folio by its per-project shortId.",
    path: "/projects/:projectId/folios/:shortId",
    schema: {
      params: z.object({
        projectId: z.integer(),
        shortId: z.integer(),
      }),
      // Every flag here exists so the folio workspace can open in ONE
      // request. Each one used to be a round-trip the browser could only
      // start after this one had resolved (they all key off the folio's
      // `id`, which the caller does not have — it addresses the folio by
      // `shortId`), so they could not even join the client's batch window.
      //
      // `withLinks=true` attaches the resolved [[wiki-link]] index.
      // `withPath=true` attaches the folio's directory chain (root → … →
      // direct parent), which renders the AppShell breadcrumb without a
      // separate `listAllDirectories`. `withBlobs=true` attaches the
      // attachment list. `withRevisionCount=true` attaches the number the
      // meta bar shows — a count, NOT the revisions themselves; see
      // `folioMetadataSchema.revisionCount` for why the rows stay behind
      // `listHistory`.
      query: z.object({
        withLinks: z.boolean().optional(),
        withPath: z.boolean().optional(),
        withBlobs: z.boolean().optional(),
        withRevisionCount: z.boolean().optional(),
      }),
      response: folioResourceSchema,
    },
    handler: async ({ params, query, user }) => {
      await this.security.assertMember(params.projectId, user);
      const folio = await this.folios.findOne({
        where: {
          projectId: { eq: params.projectId },
          shortId: { eq: params.shortId },
        },
      });
      if (!folio) throw new NotFoundError("Folio not found");
      if (
        !query.withLinks &&
        !query.withPath &&
        !query.withBlobs &&
        !query.withRevisionCount
      ) {
        return folio;
      }
      // Every requested extra is independent of the others, so they run
      // concurrently — the handler costs one round of queries, not one
      // per flag.
      const [links, path, blobs, revisionCount] = await Promise.all([
        query.withLinks ? this.resolveLinks(folio.id) : undefined,
        query.withPath
          ? this.resolveDirectoryPath(folio.directoryId)
          : undefined,
        query.withBlobs
          ? this.blobService.listHydratedByFolio(folio.id)
          : undefined,
        query.withRevisionCount
          ? this.revisions.count({ folioId: { eq: folio.id } })
          : undefined,
      ]);
      return { ...folio, metadata: { links, path, blobs, revisionCount } };
    },
  });

  /**
   * Walk the folio-directory chain from `directoryId` up to the root.
   * Returns `[root, ..., directParent]` — empty when the folio lives at
   * the project root. Bounded by `folioDirectories` depth-cap (8).
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
      await this.security.assertMember(folio.projectId, user);
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
      await this.security.assertMember(folio.projectId, user);
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
            columns: ["id", "shortId", "title", "directoryId", "projectId"],
          })
        : Promise.resolve([]),
      outQuestIds.length > 0
        ? this.linkService.findQuestRefs(outQuestIds)
        : Promise.resolve([]),
      outBlobIds.length > 0
        ? this.blobs.findMany({
            where: { fileId: { inArray: outBlobIds } },
            columns: ["fileId", "shortId", "name", "folioId", "projectId"],
          })
        : Promise.resolve([]),
      inb.length > 0
        ? this.folios.findMany({
            where: { id: { inArray: inb.map((l) => l.fromId) } },
            columns: ["id", "shortId", "title", "directoryId", "projectId"],
          })
        : Promise.resolve([]),
    ]);

    // Build a single per-project directory map up front. All linked
    // folios + blobs share the source's project (link rows are
    // tenant-scoped via folio_id), so one fetch covers every ref's
    // ancestor walk and avoids N+1 findOne calls per directory.
    const projectIds = new Set<number>();
    for (const f of folioRefs) projectIds.add(f.projectId);
    for (const b of blobRefs) projectIds.add(b.projectId);
    for (const f of inboundRefs) projectIds.add(f.projectId);
    const dirRows = projectIds.size
      ? await this.directories.findMany({
          where: { projectId: { inArray: [...projectIds] } },
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
            // No folder chain: an attachment hangs off one folio rather
            // than sitting in a directory, so any path shown here would
            // be the owning folio's, not the blob's. `path` is optional
            // and the Links tab renders blob rows as plain text anyway.
            path: undefined,
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
   * in the same project and returns the canonical UUID. `null` /
   * `undefined` → root (returns `undefined`).
   *
   * Cross-type name uniqueness (folio vs blob vs other-folio in the
   * same directory) is enforced separately via the `folio_names`
   * reservation table — see `FolioDirectoryService` (Phase B).
   */
  protected async resolveDirectoryId(
    directoryId: string | null | undefined,
    projectId: number,
  ): Promise<string | undefined> {
    if (directoryId === null || directoryId === undefined) return undefined;
    const directory = await this.directories.findOne({
      where: {
        id: { eq: directoryId },
        projectId: { eq: projectId },
      },
    });
    if (!directory) {
      throw new BadRequestError("Directory not found in this project");
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
        projectId: z.integer(),
        /**
         * Folio directory the folio lives in. `null` / omitted →
         * project root. See quest [[#66]] — folios no longer nest in
         * other folios, they sit in folio directories.
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
      await this.security.assertMember(body.projectId, user);
      const tags = (body.tags ?? []).map((t) => t.trim()).filter(Boolean);
      const summary = (body.summary ?? "").trim();
      const content = body.content ?? "";
      const isProtected = body.protected === true;
      const pinned = body.pinned === true;
      const directoryId = await this.resolveDirectoryId(
        body.directoryId,
        body.projectId,
      );
      const shortId = await this.folioShortId.next(String(body.projectId));
      const folio = await this.folios.create({
        projectId: body.projectId,
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
         * Move the folio to a different folio directory. `null` →
         * project root; `undefined` → leave untouched.
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
      await this.security.assertMember(existing.projectId, user);

      // A protected row's `content` is a passphrase-encrypted envelope the
      // server cannot interpret. A caller that writes new `content` against
      // a protected row WITHOUT stating `protected` does not know — or does
      // not assert — which cryptographic domain that content belongs to;
      // in practice it means an editor that has no idea the folio is
      // protected sending its own plaintext buffer. Writing it anyway would
      // silently replace the ciphertext with plaintext while leaving
      // `protected: true` set on the row (undecryptable ever after) and
      // would never trigger the purge below, since `isProtected` would
      // still equal `existing.protected`. A plaintext snapshot would also
      // land in `folio_revisions`, violating the protection-domain
      // invariant (see apps/lore/CLAUDE.md's "Protected folios" section).
      // Require the caller to explicitly assert the protection state of
      // the content it is sending: `protected: true` to stay protected
      // (re-encrypt in place) or `protected: false` to remove protection —
      // both are legitimate, explicit transitions and stay allowed.
      if (
        existing.protected &&
        body.content !== undefined &&
        body.protected === undefined
      ) {
        throw new BadRequestError(
          "This folio is protected. Updating its content requires explicitly asserting `protected` (true to re-encrypt, false to remove protection) — omitting it is refused to avoid silently overwriting the encrypted content with plaintext.",
        );
      }

      const title = body.title ?? existing.title;
      const content = body.content ?? existing.content;
      const tags = body.tags
        ? body.tags.map((t) => t.trim()).filter(Boolean)
        : existing.tags;
      const summary =
        body.summary !== undefined ? body.summary.trim() : existing.summary;

      // `null` from the caller = "explicit move to project root" — must
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
            existing.projectId,
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
      // pre-encryption plaintext snapshot readable by any project member
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
      await this.security.assertMember(existing.projectId, user);
      // Folios no longer have folio children since quest #66 — they're
      // leaves under folio directories. So a plain delete is enough;
      // folio_links + folio_revisions cascade via their FKs.
      await this.folios.deleteById(params.id);
      return { ok: true };
    },
  });

  // ---------------------------------------------------------------------------
  // History — the folio's revision history (#63)
  // ---------------------------------------------------------------------------

  /**
   * Cross-folio activity feed for a project. Joins `folio_revisions` to
   * `folios` to scope by project, batches user-metadata resolution,
   * caps at 50 rows by construction.
   *
   * Bounded by the per-folio retention cap × folio count, so no cursor
   * pagination in v1. Revisit if this query shows up in the slow-query log.
   *
   * **It has no browser consumer today** — this is an HTTP surface, not dead
   * code, but nothing in `src/web` calls it. It fed the "Recent activity"
   * panel of the deleted `FolioBrowser` (Lore #105), and Lore #134 decided
   * against rebuilding that panel as an inspector tab: the inspector is
   * keyed to the folio open in the document pane (Outline / History / Links
   * all describe THAT folio), and a project-wide feed is navigation, which
   * is the tree's job. Keep the endpoint — a feed is cheap to surface again
   * somewhere it belongs, and `folio_revisions` is the only place the
   * "who changed what, when" question can be answered across folios.
   */
  listProjectActivity = $action({
    use: [$secure({ permissions: ["folio:read"] })],
    path: "/folios/activity",
    description:
      "Recent folio activity in a project (revisions across all folios, newest first).",
    schema: {
      query: z.object({
        projectId: z.integer(),
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
      await this.security.assertMember(query.projectId, user);
      const limit = query.limit ?? 50;

      // One statement: the project is reached by filtering on the revision's
      // folio, and the folio and author both come back attached.
      const revisions = await this.revisionsWith.findMany({
        where: { folio: { projectId: { eq: query.projectId } } },
        orderBy: [{ column: "at", direction: "desc" }],
        limit,
        include: {
          folio: { select: ["id", "shortId", "title"] },
          author: { select: ["id", "username", "email", "picture"] },
        },
      });

      return {
        items: revisions.map((r) => {
          const folio = r.folio;
          const u = r.author;
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
      await this.security.assertMember(folio.projectId, user);
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
      await this.security.assertMember(folio.projectId, user);

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
      await this.security.assertMember(folio.projectId, user);
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
