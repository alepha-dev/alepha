import {
  type ResourceRef,
  $ownsProject,
  BestEffort,
  BoundParameters,
  LoreAudits,
  ResourceLinkService,
} from "@lore/core/api";
import type { LinkSourceKind, LinkTargetKind } from "@lore/core/schemas";
import { $inject, z } from "alepha";
import { users } from "alepha/api/users";
import { CryptoProvider } from "alepha/crypto";
import { DateTimeProvider } from "alepha/datetime";
import { $repository, $sequence } from "alepha/orm";
import { OwnedResourceProvider, type UserAccountToken } from "alepha/security";
import {
  $action,
  BadRequestError,
  NotFoundError,
  okSchema,
} from "alepha/server";

import { folioDirectories } from "../entities/folioDirectories.ts";
import { folioRevisions } from "../entities/folioRevisions.ts";
import {
  type Folio,
  buildFolioSearchText,
  folios,
} from "../entities/folios.ts";
import { knowledgeRelations } from "../relations/knowledgeRelations.ts";
import { folioIdParamsSchema } from "../schemas/folioIdParamsSchema.ts";
import { folioListQuerySchema } from "../schemas/folioListQuerySchema.ts";
import {
  folioLinksSchema,
  folioResourceSchema,
} from "../schemas/folioResourceSchema.ts";
import { folioRowSchema } from "../schemas/folioRowSchema.ts";
import { folioSavedSchema } from "../schemas/folioSavedSchema.ts";
import {
  type FolioTreeEntry,
  folioTreeEntrySchema,
} from "../schemas/folioTreeEntrySchema.ts";
import { FolioAttachmentService } from "../services/FolioAttachmentService.ts";
import {
  FolioHistoryService,
  type RevisionPlan,
} from "../services/FolioHistoryService.ts";
import { FolioNameService } from "../services/FolioNameService.ts";
import { FolioRevisionStatsService } from "../services/FolioRevisionStatsService.ts";

/**
 * The columns of `folio_directories` any ancestor walk needs — the tree
 * edge (`parentId`) plus what a breadcrumb segment displays.
 */
type DirectoryRow = {
  id: string;
  shortId: number;
  name: string;
  parentId?: string;
};

/**
 * Resolves the project's directories, once per request at most. See
 * `FolioController.directoryMapLoader`.
 */
type DirectoryMapLoader = () => Promise<Map<string, DirectoryRow>>;

export class FolioController {
  folios = $repository(folios);
  protected readonly directories = $repository(folioDirectories);
  /**
   * ...with the author attached, for the project activity feed.
   */
  protected readonly revisionsWith = $repository(
    knowledgeRelations,
    "folioRevisions",
  );
  protected readonly users = $repository(users);
  protected readonly linkService = $inject(ResourceLinkService);
  protected readonly bound = $inject(BoundParameters);
  protected readonly attachmentService = $inject(FolioAttachmentService);
  protected readonly historyService = $inject(FolioHistoryService);
  protected readonly nameService = $inject(FolioNameService);
  protected readonly crypto = $inject(CryptoProvider);
  protected readonly dateTime = $inject(DateTimeProvider);
  protected readonly bestEffort = $inject(BestEffort);
  protected readonly revisionStats = $inject(FolioRevisionStatsService);
  protected readonly audits = $inject(LoreAudits);
  protected readonly owned = $inject(OwnedResourceProvider);

  /**
   * One project-layer audit row for something that happened to a folio.
   *
   * `resourceId` is the **shortId**, matching `/:projectSlug/folios/:shortId`.
   *
   * ⚠️ Never the folio's CONTENT, not even a prefix. A protected folio's body
   * is ciphertext the server cannot read by design, and an unprotected one is
   * still member-gated behind the folio itself; the Activity page is a wider
   * surface than that. The title is what the feed prints, and a protected
   * folio's title is not secret - it is shown in the tree.
   */
  protected async logFolio(
    action: string,
    folio: { shortId: number; title: string; projectId: number },
    user: UserAccountToken | undefined,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    await this.audits.folio.logSuccess(action, {
      ...this.audits.actor(user),
      ...this.audits.scope(folio.projectId),
      resourceType: "folio",
      resourceId: String(folio.shortId),
      description: folio.title,
      ...(metadata ? { metadata } : {}),
    });
  }

  /**
   * The four gates this controller needs - the only place in the app where
   * all three id sources appear on one class.
   *
   * Declared above the actions on purpose: `use: [this.ownsFolio()]` is a
   * field initializer reading another field, so a gate declared below its
   * first use is `undefined` at construction time.
   */
  protected ownsProject = (requires: string | string[]) =>
    $ownsProject({ requires, param: "projectId" });

  protected ownsProjectFromQuery = (requires: string | string[]) =>
    $ownsProject({ requires, param: "projectId", from: "query" });

  protected ownsProjectFromBody = (requires: string | string[]) =>
    $ownsProject({ requires, param: "projectId", from: "body" });

  /**
   * Member gate on the project the folio named by `params.id` belongs to.
   *
   * The folio itself lands on `this.owned.get<Folio>()`, which matters most
   * to `update`: the protection-domain invariant is decided against the
   * EXISTING row, and that row is now read once, by the gate.
   */
  protected ownsFolio = (requires: string | string[]) =>
    $ownsProject({ requires, repository: () => this.folios, param: "id" });

  /**
   * The same two gates plus the Knowledge capability, for the writes.
   *
   * Reads stay open on purpose: a project that turns Knowledge back on has to
   * find every folio exactly where it left them, and an endpoint refusing to
   * read them is how that becomes impossible to verify.
   */
  protected ownsProjectFromBodyForKnowledge = (requires: string | string[]) =>
    $ownsProject({
      requires,
      param: "projectId",
      from: "body",
      capability: "knowledge",
    });

  protected ownsFolioForKnowledge = (requires: string | string[]) =>
    $ownsProject({
      requires,
      repository: () => this.folios,
      param: "id",
      capability: "knowledge",
    });

  /**
   * Per-project sequence for `folios.shortId`. Powers the human-friendly
   * `/p/:projectId/folios/:shortId` URL.
   */
  protected folioShortId = $sequence();

  /**
   * How many numbers one `listFolioRefs` call reads. No hand-written document
   * names this many folios; the cap keeps a crafted query from turning into
   * dozens of D1 statements.
   */
  static readonly MAX_REF_IDS = 500;

  /**
   * List folios in a project (project-shared — any member sees every
   * folio). Optional `q` runs `LIKE %q%` over `searchText`.
   */
  list = $action({
    use: [this.ownsProjectFromQuery("folio:read")],
    description: "List the project's folios (newest first).",
    schema: {
      query: folioListQuerySchema,
      response: z.array(folioRowSchema),
    },
    handler: async ({ query }) => {
      const where: Record<string, unknown> = {
        projectId: { eq: query.projectId },
      };
      if (query.q) {
        where.searchText = { like: `%${query.q.toLowerCase()}%` };
      }
      const orderBy = [
        { column: "pinned" as const, direction: "desc" as const },
        { column: "updatedAt" as const, direction: "desc" as const },
      ];
      if (query.epicId == null) {
        return this.withEpics(
          await this.folios.findMany({
            where,
            orderBy,
            limit: query.limit ?? 50,
            offset: query.offset ?? 0,
          }),
        );
      }
      // An epic's folios are its `filed` links in core's graph (#Q2626),
      // read in bounded batches and paged here: a folio does not know its
      // epic.
      const filed = await this.linkService.filedChildren(
        { kind: "epic", id: query.epicId },
        "folio",
      );
      const rows = await this.bound.collect(filed, (batch) =>
        this.folios.findMany({
          where: { ...where, id: { inArray: batch } },
          orderBy,
        }),
      );
      rows.sort(
        (a, b) =>
          Number(b.pinned) - Number(a.pinned) ||
          (b.updatedAt > a.updatedAt ? 1 : b.updatedAt < a.updatedAt ? -1 : 0),
      );
      const offset = query.offset ?? 0;
      return this.withEpics(rows.slice(offset, offset + (query.limit ?? 50)));
    },
  });

  /**
   * The folios a document names, as `{ shortId, title }`, for the wiki-link
   * resolver (#Q2355).
   *
   * `list` above serves the tree and the `[[` picker, and it is a capped page
   * of whole rows. Resolving a `[[#F12]]` against that page broke every
   * reference to a folio outside it. This reads only the numbers the body
   * carries, and only two columns of each.
   *
   * `shortIds` is comma-separated; anything that is not a positive integer
   * is dropped rather than refused, and at most
   * {@link FolioController.MAX_REF_IDS} are read.
   */
  listFolioRefs = $action({
    use: [this.ownsProject("folio:read")],
    method: "GET",
    description: "Titles of the folios with the given per-project shortIds.",
    path: "/projects/:projectId/folios/refs",
    schema: {
      params: z.object({ projectId: z.integer() }),
      query: z.object({ shortIds: z.string() }),
      response: z.array(
        z.object({
          shortId: z.integer(),
          title: z.string(),
        }),
      ),
    },
    handler: async ({ params, query }) => {
      const shortIds = [
        ...new Set(
          query.shortIds
            .split(",")
            .map((entry) => Number(entry.trim()))
            .filter((n) => Number.isSafeInteger(n) && n > 0),
        ),
      ].slice(0, FolioController.MAX_REF_IDS);
      const rows = await this.bound.collect(shortIds, (batch) =>
        this.folios.findMany({
          where: {
            projectId: { eq: params.projectId },
            shortId: { inArray: batch },
          },
          columns: ["shortId", "title"],
        }),
      );
      return rows.map((r) => ({ shortId: r.shortId, title: r.title }));
    },
  });

  /**
   * Every folio of the project, as the tree draws it, unpaged (#Q2510).
   *
   * `list` is a capped page of whole rows, and the tree, the router's seed
   * and the pickers each asked it for 100: in a project past 100 folios the
   * older ones were simply missing, directories looked emptier than they
   * were, and the pickers could not offer them. This reads every row but
   * only the columns of {@link folioTreeEntrySchema}, so the whole list of a
   * large project weighs less than the old page of 100 bodies.
   *
   * The one body it carries is a pinned, unprotected folio's, in a second
   * read bounded by what is pinned: the pinned-budget bar sums those.
   */
  tree = $action({
    use: [this.ownsProject("folio:read")],
    method: "GET",
    description: "Every folio of the project, without bodies, for the tree.",
    path: "/projects/:projectId/folios/tree",
    schema: {
      params: z.object({ projectId: z.integer() }),
      response: z.array(folioTreeEntrySchema),
    },
    handler: async ({ params }) => {
      const [rows, pinned] = await Promise.all([
        this.folios.findMany({
          where: { projectId: { eq: params.projectId } },
          columns: [
            "id",
            "shortId",
            "createdAt",
            "updatedAt",
            "projectId",
            "title",
            "protected",
            "pinned",
            "directoryId",
            "summary",
          ],
          orderBy: [
            { column: "pinned", direction: "desc" },
            { column: "updatedAt", direction: "desc" },
          ],
        }),
        this.folios.findMany({
          where: {
            projectId: { eq: params.projectId },
            pinned: { eq: true },
            protected: { eq: false },
          },
          columns: ["id", "content"],
        }),
      ]);
      const bodies = new Map(pinned.map((row) => [row.id, row.content]));
      return (await this.withEpics(rows)).map((row) => {
        const content = bodies.get(row.id);
        return content === undefined ? row : { ...row, content };
      }) as FolioTreeEntry[];
    },
  });

  getByShortId = $action({
    // Gated on the PARAM, not on the folio it finds: the lookup is by
    // (project, shortId), so there is nothing to hop from, and a foreign
    // project is refused before the folios table is touched.
    use: [this.ownsProject("folio:read")],
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
      // separate `listAllDirectories`. `withAttachments=true` attaches the
      // attachment list.
      //
      // There was a `withRevisionCount` here too, feeding the meta bar's
      // "N revisions". It went with the meta bar — nothing outside the
      // History tab counts revisions now, and that tab has the rows.
      query: z.object({
        withLinks: z.boolean().optional(),
        withPath: z.boolean().optional(),
        withAttachments: z.boolean().optional(),
      }),
      response: folioResourceSchema,
    },
    handler: async ({ params, query }) => {
      const found = await this.folios.findOne({
        where: {
          projectId: { eq: params.projectId },
          shortId: { eq: params.shortId },
        },
      });
      if (!found) throw new NotFoundError("Folio not found");
      const [folio] = await this.withEpics([found]);
      if (!query.withLinks && !query.withPath && !query.withAttachments) {
        return folio;
      }
      // Every requested extra is independent of the others, so they run
      // concurrently — the handler costs one round of queries, not one
      // per flag.
      //
      // `withPath` and `withLinks` both need to turn directory ids into
      // ancestor chains, and they used to do it two different ways: the
      // link resolver read the project's directories in one shot, while
      // the path resolver walked the chain one `findOne` per level. One
      // loader now serves both, so the deeper the folio the more this
      // saves — and it is lazy, so a folio at the project root with no
      // links still reads no directories at all.
      const loadDirectories = this.directoryMapLoader(folio.projectId);
      const [links, path, attachments] = await Promise.all([
        query.withLinks
          ? this.resolveLinks(folio.id, folio.projectId, loadDirectories)
          : undefined,
        query.withPath
          ? this.resolveDirectoryPath(folio.directoryId, loadDirectories)
          : undefined,
        query.withAttachments
          ? this.attachmentService.listHydratedByFolio(folio.id)
          : undefined,
      ]);
      return { ...folio, metadata: { links, path, attachments } };
    },
  });

  /**
   * A lazily-resolved `id → directory` map for one project, fetched AT
   * MOST ONCE however many callers ask for it, and never at all if none
   * of them do.
   *
   * Laziness is the whole point, not an optimization detail: a folio at
   * the project root with no `[[links]]` needs no directory rows, and
   * eagerly loading the map would turn its zero directory queries into
   * one. Memoizing on the promise (not the resolved value) is what makes
   * the concurrent `Promise.all` callers share a single fetch instead of
   * racing two.
   */
  protected directoryMapLoader(projectId: number): DirectoryMapLoader {
    let pending: Promise<Map<string, DirectoryRow>> | undefined;
    return () => {
      pending ??= this.directories
        .findMany({
          where: { projectId: { eq: projectId } },
          columns: ["id", "shortId", "name", "parentId"],
        })
        .then(
          (rows) => new Map((rows as DirectoryRow[]).map((d) => [d.id, d])),
        );
      return pending;
    };
  }

  /**
   * Walk the folio-directory chain from `directoryId` up to the root.
   * Returns `[root, ..., directParent]` — empty when the folio lives at
   * the project root. Bounded by `folioDirectories` depth-cap (8).
   *
   * Walks the in-memory map rather than issuing a `findOne` per level:
   * the old version cost one query per directory the folio was nested
   * in, up to that cap, for a breadcrumb. The `seen` guard stays — a
   * `parentId` cycle is a database state the tree builder already knows
   * how to survive, and here it would be an infinite loop rather than an
   * N+1.
   */
  protected async resolveDirectoryPath(
    directoryId: string | undefined,
    loadDirectories: DirectoryMapLoader,
  ): Promise<{ shortId: number; name: string }[]> {
    if (!directoryId) return [];
    const dirById = await loadDirectories();
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
    return chain;
  }

  get = $action({
    use: [this.ownsFolio("folio:read")],
    description: "Get a single folio by id.",
    schema: {
      params: folioIdParamsSchema,
      response: folioRowSchema,
    },
    handler: async () => (await this.withEpics([this.owned.get<Folio>()]))[0],
  });

  /**
   * Return the resolved outbound + inbound `[[wiki-link]]` refs for a
   * folio, as `{ shortId, title }` pairs ready for display. Separate from
   * `get` so the latter's existing `folios.schema` response stays stable;
   * MCP `folio_get` calls both and merges.
   */
  getLinks = $action({
    use: [this.ownsFolio("folio:read")],
    description: "Get wiki-link outbound + inbound refs for a folio.",
    schema: {
      params: folioIdParamsSchema,
      response: folioLinksSchema,
    },
    handler: async () => {
      const folio = this.owned.get<Folio>();
      return this.resolveLinks(
        folio.id,
        folio.projectId,
        this.directoryMapLoader(folio.projectId),
      );
    },
  });

  /**
   * Stamp each folio with the epic that files it, read from core's link
   * graph (#Q2626): one bounded read for the whole page.
   *
   * It overwrites the row's own `epicId`, which nothing writes any more and
   * #Q2627 drops: the HTTP and MCP contracts keep the field, and a stale
   * column value must never reach them.
   */
  protected async withEpics<T extends { id: string }>(
    rows: T[],
  ): Promise<Array<T & { epicId: number | undefined }>> {
    const parents =
      rows.length === 0
        ? new Map<string, string>()
        : await this.linkService.filedParents(
            "epic",
            "folio",
            rows.map((row) => row.id),
          );
    return rows.map((row) => {
      const epic = parents.get(row.id);
      return { ...row, epicId: epic === undefined ? undefined : Number(epic) };
    });
  }

  /**
   * Resolve outbound + inbound `[[wiki-link]]` refs for a folio into
   * `{ kind, shortId, title }` pairs. Caller is responsible for the
   * membership check on the folio itself.
   */
  protected async resolveLinks(
    folioId: string,
    projectId: number,
    loadDirectories: DirectoryMapLoader,
  ) {
    const [out, inb] = await Promise.all([
      this.linkService.findOutbound({ kind: "folio", id: folioId }),
      this.linkService.findInbound(folioId),
    ]);

    // Folios resolve here, with their folder chain. Every other kind
    // resolves through the module that registers it (`ResourceRegistry`),
    // so this controller reads no other module's table; a kind no module
    // registers describes nothing, and its rows are dropped below rather
    // than rendered blank. Inbound rows are grouped by the kind of element
    // that CONTAINS the reference: `comment` is not a registered kind, and is
    // dropped the same way.
    const outFolioIds = out
      .filter((l) => l.targetType === "folio")
      .map((l) => l.toId);
    const inboundFolioIds = inb
      .filter((l) => l.fromType === "folio")
      .map((l) => l.fromId);
    const idsByKind = (rows: Array<{ kind: string; id: string }>) => {
      const grouped = new Map<string, string[]>();
      for (const row of rows) {
        if (row.kind === "folio") continue;
        grouped.set(row.kind, [...(grouped.get(row.kind) ?? []), row.id]);
      }
      return grouped;
    };
    const describeAll = async (grouped: Map<string, string[]>) => {
      const refs = new Map<string, ResourceRef>();
      await Promise.all(
        [...grouped].map(async ([kind, ids]) => {
          for (const ref of await this.linkService.describe(
            kind,
            projectId,
            ids,
          )) {
            refs.set(`${kind}:${ref.id}`, ref);
          }
        }),
      );
      return refs;
    };

    const [folioRefs, inboundRefs, outRefs, inRefs] = await Promise.all([
      this.bound.collect(outFolioIds, (batch) =>
        this.folios.findMany({
          where: { id: { inArray: batch } },
          columns: ["id", "shortId", "title", "directoryId", "projectId"],
        }),
      ),
      // Folio SOURCES only. Since links went polymorphic an inbound row
      // can come from a quest or an epic, whose stringified integer ids
      // must never be handed to the folios repository as UUIDs.
      this.bound.collect(inboundFolioIds, (batch) =>
        this.folios.findMany({
          where: { id: { inArray: batch } },
          columns: ["id", "shortId", "title", "directoryId", "projectId"],
        }),
      ),
      describeAll(
        idsByKind(out.map((l) => ({ kind: l.targetType, id: l.toId }))),
      ),
      describeAll(
        idsByKind(inb.map((l) => ({ kind: l.fromType, id: l.fromId }))),
      ),
    ]);

    // One per-project directory map covers every ref's ancestor walk and
    // avoids N+1 findOne calls per directory. It comes from the caller's
    // shared loader, so `withPath` on the same request reads the same
    // rows rather than fetching its own — and a folio with no refs at
    // all never triggers the fetch, which is what the `projectIds.size`
    // guard preserves.
    //
    // The loader is scoped to the SOURCE folio's project. Every linked
    // folio shares it, because link rows are tenant-scoped via `folio_id`
    // and the `[[...]]` resolver only ever matches numbers inside one
    // project. `extraProjectIds` is the belt to that braces:
    // if a cross-project ref ever appears it is fetched rather than
    // silently rendered without its path.
    const projectIds = new Set<number>();
    for (const f of folioRefs) projectIds.add(f.projectId);
    for (const f of inboundRefs) projectIds.add(f.projectId);
    const dirById = projectIds.size
      ? new Map(await loadDirectories())
      : new Map<string, DirectoryRow>();
    const extraProjectIds = [...projectIds].filter((p) => p !== projectId);
    if (extraProjectIds.length > 0) {
      const extra = (await this.directories.findMany({
        where: { projectId: { inArray: extraProjectIds } },
        columns: ["id", "shortId", "name", "parentId"],
      })) as DirectoryRow[];
      for (const d of extra) dirById.set(d.id, d);
    }
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
    const inboundById = new Map(inboundRefs.map((r) => [r.id, r]));

    /**
     * One inbound row: the element that CONTAINS a reference to this folio.
     */
    type InRef = {
      kind: LinkSourceKind;
      shortId: number;
      title: string;
      path?: { shortId: number; name: string }[];
    };
    type OutRef = {
      kind: LinkTargetKind;
      shortId: number;
      title: string;
      path?: { shortId: number; name: string }[];
      /**
       * Releases only: what `/releases/:releaseTag` navigates by.
       */
      tag?: string;
    };
    const outbound: OutRef[] = [];
    for (const l of out) {
      if (l.targetType === "folio") {
        const ref = folioById.get(l.toId);
        if (ref)
          outbound.push({
            kind: "folio",
            shortId: ref.shortId,
            title: ref.title,
            path: pathOf(ref.directoryId),
          });
        continue;
      }
      // An epic's and a release's `number` rides under `shortId`; only a
      // release carries a tag. Nothing outside the folio tree has a path.
      const ref = outRefs.get(`${l.targetType}:${l.toId}`);
      if (ref)
        outbound.push({
          kind: l.targetType,
          shortId: ref.shortId,
          title: ref.title,
          ...(ref.tag !== undefined ? { tag: ref.tag } : {}),
        });
    }
    return {
      outbound,
      inbound: inb.flatMap((l): InRef[] => {
        if (l.fromType !== "folio") {
          const ref = inRefs.get(`${l.fromType}:${l.fromId}`);
          return ref
            ? [{ kind: l.fromType, shortId: ref.shortId, title: ref.title }]
            : [];
        }
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
   * Sibling-name uniqueness (a folio against the other folios AND the
   * directories in the same folder) is enforced separately, through the
   * `folio_names` reservation table - see `reserveTitle` below.
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
    use: [this.ownsProjectFromBodyForKnowledge("folio:write")],
    description: "Create a new folio.",
    schema: {
      body: z.object({
        title: z.string().min(1).max(200),
        content: z.string().optional(),
        summary: z.string().max(500).optional(),
        projectId: z.integer(),
        /**
         * Folio directory the folio lives in. `null` / omitted →
         * project root. See quest #Q66 — folios no longer nest in
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
        /**
         * Pin the folio on creation. Defaults to false.
         */
        pinned: z.boolean().optional(),
      }),
      response: folioSavedSchema,
    },
    handler: async ({ body, user }) => {
      const summary = (body.summary ?? "").trim();
      const content = body.content ?? "";
      const isProtected = body.protected === true;
      const pinned = body.pinned === true;
      const directoryId = await this.resolveDirectoryId(
        body.directoryId,
        body.projectId,
      );
      // Drive-style: a title already taken in this folder is suffixed
      // rather than refused, exactly as `FolioDirectoryService.create`
      // does for a directory. The name is CLAIMED before the row exists,
      // under an id generated here (#Q2548): there is no transaction (D1),
      // so a reservation written after the insert could lose the race and
      // leave a committed folio with the same title and no reservation. A
      // racer that loses the claim re-suffixes instead.
      const scope = this.nameService.scopeOf(body.projectId, directoryId);
      const id = this.crypto.randomUUIDv7(this.dateTime.nowMillis());
      const title = await this.nameService.claim(
        body.title,
        "folio",
        id,
        scope,
      );
      let folio: Folio;
      try {
        const shortId = await this.folioShortId.next(String(body.projectId));
        folio = await this.folios.create({
          id,
          projectId: body.projectId,
          shortId,
          title,
          content,
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
                title,
                summary,
                content,
              }),
        });
      } catch (error) {
        await this.bestEffort.run(
          "createFolio: releasing the claimed name failed",
          () => this.nameService.releaseByEntity(id),
        );
        throw error;
      }
      const created = folio;
      // Everything below follows the committed row, and is best effort
      // (#Q2555): a failure is logged as a blight, never a 500 that invites
      // a retry creating a second folio.
      //
      // Sync outbound `[[...]]` references. Skipped for protected folios
      // since `content` is ciphertext — scanning it for `[[...]]` would
      // generate noisy junk links from base64 chars.
      if (!isProtected) {
        // A brand-new id has no links to clear, so the delete is skipped.
        await this.bestEffort.run("createFolio: link sync failed", () =>
          this.linkService.syncLinks(this.folioSource(created), content, {
            created: true,
          }),
        );
      }
      // Seed the revision log with a `create` entry. Snapshot is the
      // folio as it stands right after insert — gives the History tab a
      // baseline to diff later edits against.
      await this.bestEffort.run("createFolio: create revision failed", () =>
        this.historyService.appendRevision(
          created,
          user.id,
          "create",
          undefined,
        ),
      );
      await this.logFolio("create", folio, user, { protected: isProtected });

      // Always true here: a brand-new folio has nothing to fold into. Sent
      // anyway so the two save paths answer the same shape and the client
      // never has to ask which one it called.
      return { ...folio, epicId: undefined, revisionsChanged: true };
    },
  });

  update = $action({
    // The gate is the read half of the protection-domain check below, and
    // the version the write is guarded by. No transaction (D1 has none).
    use: [this.ownsFolioForKnowledge("folio:write")],
    description: "Update a folio.",
    schema: {
      params: folioIdParamsSchema,
      body: z.object({
        title: z.string().min(1).max(200).optional(),
        content: z.string().optional(),
        summary: z.string().max(500).optional(),
        /**
         * Move the folio to a different folio directory. `null` →
         * project root; `undefined` → leave untouched.
         */
        directoryId: z.uuid().nullable().optional(),
        /**
         * Toggle protected state.
         *
         * A change of state must carry the `content` that matches it
         * (plaintext markdown when false, crypto envelope when true); the
         * handler refuses the flip otherwise, rather than leaving the folio
         * holding a value from the domain it just left. Restating the current
         * state is not a change and needs no content.
         */
        protected: z.boolean().optional(),
        /**
         * Pin/unpin the folio. Omitted leaves the current state.
         */
        pinned: z.boolean().optional(),
      }),
      response: folioSavedSchema,
    },
    handler: async ({ params, body, user }) => {
      // The row the protection-domain invariant is decided against, read by
      // the gate rather than a second time here.
      const existing = this.owned.get<Folio>();

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

      // The mirror image: `protected` changes but no `content` comes with it,
      // so `content` falls back to `existing.content` and the row keeps a
      // value from the domain it just left.
      //
      // Turning protection ON that way is the serious half. The row ends up
      // holding readable plaintext while claiming to be encrypted, and every
      // signal around it agrees with the claim: `searchText` is blanked, the
      // outbound links are wiped, `purgeRevisions` throws the history away,
      // and the editor offers a passphrase prompt for a folio nothing ever
      // encrypted. Deleting the history is what makes it unrecoverable rather
      // than merely wrong. Turning it OFF is the cheaper direction, publishing
      // the raw envelope as if it were markdown.
      //
      // Stating the state the folio is already in is not a transition and
      // stays allowed, so a rename, a move or a pin can still assert it.
      if (
        body.protected !== undefined &&
        body.protected !== existing.protected &&
        body.content === undefined
      ) {
        throw new BadRequestError(
          `Changing \`protected\` requires sending \`content\` in the matching form: the encrypted envelope when turning protection on, plaintext markdown when turning it off. Received \`protected: ${body.protected}\` with no content, which would leave the folio holding ${existing.protected ? "an unreadable envelope" : "readable plaintext"}.`,
        );
      }

      const desiredTitle = body.title ?? existing.title;
      const content = body.content ?? existing.content;
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

      // The order is the whole design (#Q2549). Lore runs on D1: nothing
      // rolls a write back, so every step that must not be lost runs
      // BEFORE the folio row is written, and everything after it is best
      // effort.
      //
      // 1. The name, as one UPDATE of the folio's own reservation row: a
      //    collision answers 409 and keeps the old name guarded.
      const title = await this.reserveTitle(
        params.id,
        existing,
        desiredTitle,
        directoryId,
      );
      const renamed =
        title !== existing.title ||
        (directoryId ?? undefined) !== existing.directoryId;

      const purged = isProtected !== existing.protected;
      let plan: RevisionPlan | undefined;
      let updated: Folio;
      try {
        // 2. Crossing the protection boundary invalidates every stored
        //    snapshot: they belong to the previous cryptographic domain.
        //    Going clear → protected this is the confidentiality fix, and
        //    it runs BEFORE the row turns protected, so no failure can
        //    leave a protected folio with plaintext revisions or links.
        //    The honest cost: a failure after this and before the write
        //    leaves the folio clear with its history already purged.
        if (purged) {
          await this.historyService.purgeRevisions(params.id);
          if (isProtected) {
            // The plaintext `[[links]]` would leak what the folio
            // references once it is ciphertext.
            await this.linkService.syncLinks(this.folioSource(existing), "");
          }
        }

        // 3. The live head materialized from the body as it was read, so
        //    a failure after the write can never lose it from history.
        //    Pin-only or reparent-only updates record no revision.
        const action = this.historyService.decideRevisionAction(
          {
            title: existing.title,
            content: existing.content,
            summary: existing.summary,
          },
          { title, content, summary },
        );
        plan = action
          ? await this.historyService.prepareRevision(
              params.id,
              user.id,
              action,
              existing.content,
            )
          : undefined;

        // 4. The row, against the version this request read: a write that
        //    landed since answers 409 instead of being overwritten. Not an
        //    `updatedAt` equality: on Postgres a never-updated row's
        //    microsecond default reads back at millisecond precision.
        updated = {
          ...existing,
          title,
          content,
          summary,
          // `null` means "move to the root": `save()` writes it as NULL.
          directoryId: directoryId as string | undefined,
          protected: isProtected,
          pinned,
          searchText: isProtected
            ? ""
            : buildFolioSearchText({ title, summary, content }),
        };
        await this.folios.save(updated);
      } catch (error) {
        if (renamed) {
          await this.bestEffort.run(
            "updateFolio: restoring the previous name failed",
            () =>
              this.reserveTitle(
                params.id,
                { ...existing, title, directoryId: directoryId ?? undefined },
                existing.title,
                existing.directoryId ?? null,
              ),
          );
        }
        throw error;
      }

      // 5. Best effort from here (#Q2555): the change has landed.
      //
      // A rename touches no other element: a folio is referenced by its
      // number (`[[#F12]]`, epic #32), which a title change leaves intact.
      // Re-sync this folio's own outbound links whenever content changed.
      if (!isProtected) {
        await this.bestEffort.run("updateFolio: link sync failed", () =>
          this.linkService.syncLinks(this.folioSource(updated), content),
        );
      }
      const revisionPlan = plan;
      const appended = revisionPlan
        ? await this.bestEffort.run("updateFolio: revision failed", () =>
            this.historyService.recordRevision(updated, user.id, revisionPlan),
          )
        : undefined;
      // See `folioSavedSchema` for why the purge is an equal partner here
      // and why this is not named `revisionCreated`. A purge with no insert
      // is rare but real: it empties the list, and a client told only about
      // insertions would keep rendering revisions the server has deleted.
      await this.logFolio("update", updated, user, {
        // What the update actually touched, from the revision decision that
        // has already computed it. `undefined` when nothing recordable moved
        // (a pin, a reparent), which is exactly the distinction the feed
        // wants to draw.
        change: plan?.action,
      });

      return {
        ...(await this.withEpics([updated]))[0],
        revisionsChanged: purged || appended?.created === true,
      };
    },
  });

  delete = $action({
    use: [this.ownsFolioForKnowledge("folio:write")],
    description: "Delete a folio.",
    schema: {
      params: folioIdParamsSchema,
      response: okSchema,
    },
    handler: async ({ params, user }) => {
      // Read before the row goes: once it is deleted, an id names nothing
      // and the feed has no title to print.
      const folio = this.owned.get<Folio>();

      // Folios no longer have folio children since quest #66 — they're
      // leaves under folio directories. `folio_revisions` still cascades
      // via its FK.
      //
      // ⚠️ `folio_links` does NOT cascade any more: `from_id` stopped being
      // a foreign key when links became polymorphic, so its outbound rows
      // have to be deleted here. Inbound rows are deliberately left — a
      // link FROM a folio that still exists TO one that no longer does is
      // a broken reference, which the reader renders as such; deleting it
      // would silently rewrite what the author wrote.
      await this.linkService.deleteLinksFrom({ kind: "folio", id: params.id });
      // And its filing: a deleted folio is filed under no epic (#Q2626).
      await this.linkService.unfileTargets("folio", [params.id]);
      /*
       * Before the folio row, not after. `folio_blobs.folioId` cascades, so
       * the moment the folio is gone so is the only record of which files
       * belonged to it - and those files, and their bytes, are in a bucket
       * nothing else references. Every folio deleted before this left its
       * attachments there, paid for and unreachable.
       */
      await this.attachmentService.deleteByFolio(params.id);
      // Hand the name back to the folder. `folio_names` has no foreign
      // key to `folios` (it discriminates by `kind`), so nothing frees
      // it on cascade - the reservation would outlive the folio and
      // block the name forever.
      await this.nameService.releaseByEntity(params.id);
      await this.folios.deleteById(params.id);
      await this.logFolio("delete", folio, user);
      return { ok: true };
    },
  });

  /**
   * Keep a folio's `folio_names` reservation in step with its title and
   * its folder, and return the title it actually got.
   *
   * A no-op when neither moved: a pin-only or content-only update must
   * not churn the reservation row, and must not risk suffixing a title
   * away from itself.
   */
  protected async reserveTitle(
    id: string,
    existing: { projectId: number; title: string; directoryId?: string },
    desiredTitle: string,
    directoryId: string | null | undefined,
  ): Promise<string> {
    const nextDirectoryId = directoryId ?? undefined;
    if (
      desiredTitle === existing.title &&
      nextDirectoryId === existing.directoryId
    ) {
      return existing.title;
    }
    const scope = this.nameService.scopeOf(existing.projectId, nextDirectoryId);
    return await this.nameService.rename(id, "folio", desiredTitle, scope);
  }

  /**
   * A folio as a link SOURCE. Exists so the four `syncLinks` call sites in
   * this controller cannot disagree about the discriminator — passing
   * `"quest"` here would file a folio's links under a quest id and they
   * would simply never be found again.
   */
  protected folioSource(folio: { id: string; projectId: number }) {
    return { kind: "folio" as const, id: folio.id, projectId: folio.projectId };
  }

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
    use: [this.ownsProjectFromQuery("folio:read")],
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
            action: folioRevisions.schema.shape.action,
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
    handler: async ({ query }) => {
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
    use: [this.ownsFolio("folio:read")],
    path: "/folios/:id/history",
    description: "List the revision history of a folio (newest first).",
    schema: {
      params: folioIdParamsSchema,
      /*
       * `folioRevisions.schema` plus the author and the per-revision
       * numbers the History tab renders.
       *
       * The author is the point: the entity carries only `byUserId`, so
       * the tab had a uuid and nothing to show. `listProjectActivity`
       * above already resolves the same join, and this mirrors it.
       *
       * ⚠️ The snapshots STAY, though the web UI no longer draws them.
       * `folio_history` (MCP) hands `contentSnapshot` to agents, which is
       * how an agent recovers a folio it damaged - the one job the
       * revision log exists for. Slimming this response would have meant
       * pointing that tool at `FolioHistoryService` directly, and the
       * service has no permission check: `assertMember` lives in this
       * handler. Saving bytes is not worth moving an authorisation
       * boundary.
       */
      response: z.array(
        z.object({
          id: z.uuid(),
          at: z.string(),
          action: folioRevisions.schema.shape.action,
          pinned: z.boolean(),
          titleSnapshot: z.string(),
          summarySnapshot: z.string(),
          contentSnapshot: z.string(),
          createdAt: z.string(),
          folioId: z.uuid(),
          byUserId: z.uuid().optional(),
          byUsername: z.string().optional(),
          byAvatarUrl: z.string().optional(),
          /**
           * Against the next-OLDER revision, so a row reads as "what this
           * edit did". The oldest row has nothing to compare against and
           * reports its whole body as added, which is what creating a
           * folio in fact did.
           */
          linesAdded: z.integer(),
          linesRemoved: z.integer(),
          words: z.integer(),
          wordsBefore: z.integer(),
          /**
           * Set only when this revision changed the title, so the client
           * can render the rename without diffing anything itself.
           */
          previousTitle: z.string().optional(),
        }),
      ),
    },
    handler: async ({ params }) => {
      const live = this.owned.get<Folio>().content;
      const revisions = await this.revisionsWith.findMany({
        where: { folioId: { eq: params.id } },
        orderBy: [
          { column: "at", direction: "desc" },
          { column: "id", direction: "desc" },
        ],
        include: {
          author: { select: ["id", "username", "email", "picture"] },
        },
      });

      return revisions.map((revision, index) => {
        // Newest first, so the next entry is the older one - the state
        // this revision replaced.
        const previous = revisions[index + 1];
        const before = previous
          ? this.historyService.contentOf(previous, live)
          : "";
        const after = this.historyService.contentOf(revision, live);
        const { added, removed } = this.revisionStats.lineDiff(before, after);
        const author = revision.author;

        return {
          id: revision.id,
          at: revision.at,
          action: revision.action,
          pinned: revision.pinned,
          titleSnapshot: revision.titleSnapshot,
          summarySnapshot: revision.summarySnapshot,
          contentSnapshot: after,
          createdAt: revision.createdAt,
          folioId: revision.folioId,
          byUserId: revision.byUserId,
          byUsername: author?.username ?? author?.email,
          byAvatarUrl: author?.picture
            ? `/api/files/${author.picture}`
            : undefined,
          linesAdded: added,
          linesRemoved: removed,
          words: this.revisionStats.wordCount(after),
          wordsBefore: this.revisionStats.wordCount(before),
          previousTitle:
            previous && previous.titleSnapshot !== revision.titleSnapshot
              ? previous.titleSnapshot
              : undefined,
        };
      });
    },
  });

  /**
   * Revert a folio to a prior revision. Doesn't truly rewind — it
   * creates a NEW revision (`action: "revert"`) with the prior
   * content, so the "corrupted" version stays in history and the user
   * can undo the revert if they did it in error.
   */
  revertHistory = $action({
    use: [this.ownsFolioForKnowledge("folio:write")],
    path: "/folios/:id/history/:revisionId/revert",
    description: "Revert a folio to a prior revision (creates a new revision).",
    schema: {
      params: z.object({
        id: z.uuid(),
        revisionId: z.uuid(),
      }),
      response: folioRowSchema,
    },
    handler: async ({ params, user }) => {
      const folio = this.owned.get<Folio>();

      const revision = await this.historyService.findRevision(
        params.revisionId,
      );
      if (!revision || revision.folioId !== folio.id) {
        throw new NotFoundError("Revision not found");
      }

      const isProtected = folio.protected;
      // Read before the write: the head revision's body IS the live
      // content, and so is what the revert's own revision fills it in with.
      const previousContent = folio.content;
      const content = this.historyService.contentOf(revision, previousContent);

      // Same order as `update` (#Q2549): the name, then the history, then
      // the row, then the best-effort rest. Restoring an older title
      // re-reserves it, which the revert never did: the current name stayed
      // reserved and the restored one unguarded.
      const title = await this.reserveTitle(
        folio.id,
        folio,
        revision.titleSnapshot,
        folio.directoryId ?? null,
      );

      let plan: RevisionPlan;
      let updated: Folio;
      try {
        plan = await this.historyService.prepareRevision(
          folio.id,
          user.id,
          "revert",
          previousContent,
        );
        // Against the version this request read, so an encrypt landing in
        // between (a write, which bumps it) refuses the revert rather than
        // writing a plaintext snapshot into a protected folio.
        updated = {
          ...folio,
          title,
          content,
          summary: revision.summarySnapshot,
          searchText: isProtected
            ? ""
            : buildFolioSearchText({
                title,
                summary: revision.summarySnapshot,
                content,
              }),
        };
        await this.folios.save(updated);
      } catch (error) {
        if (title !== folio.title) {
          await this.bestEffort.run(
            "revertFolio: restoring the previous name failed",
            () =>
              this.reserveTitle(
                folio.id,
                { ...folio, title },
                folio.title,
                folio.directoryId ?? null,
              ),
          );
        }
        throw error;
      }

      if (!isProtected) {
        await this.bestEffort.run("revertFolio: link sync failed", () =>
          this.linkService.syncLinks(this.folioSource(updated), content),
        );
      }
      const revisionPlan = plan;
      await this.bestEffort.run("revertFolio: revision failed", () =>
        this.historyService.recordRevision(updated, user.id, revisionPlan),
      );
      await this.logFolio("revert", updated, user, {
        revisionId: params.revisionId,
      });
      return (await this.withEpics([updated]))[0];
    },
  });

  /**
   * Toggle the `pinned` flag on a revision. Pinned revisions are
   * exempt from the inline retention sweep — they survive even when
   * older non-pinned revisions get dropped.
   */
  pinHistory = $action({
    use: [this.ownsFolioForKnowledge("folio:write")],
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
    handler: async ({ params, body }) => {
      const folio = this.owned.get<Folio>();
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
