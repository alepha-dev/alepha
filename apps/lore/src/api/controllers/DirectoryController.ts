import { $inject, t } from "alepha";
import { $repository, $transactional } from "alepha/orm";
import { $secure } from "alepha/security";
import { $action, NotFoundError, okSchema } from "alepha/server";
import { archiveBlobs } from "../entities/archiveBlobs.ts";
import { archiveDirectories } from "../entities/archiveDirectories.ts";
import { folios } from "../entities/folios.ts";
import { AppSecurityProvider } from "../providers/AppSecurityProvider.ts";
import { ArchiveDirectoryService } from "../services/ArchiveDirectoryService.ts";

/**
 * REST surface for the Archive directory tree. Reads scoped via
 * `assertMember`; mutations also `assertMember` (campaign-shared, per
 * folio #4 Q2). Cycle / depth / uniqueness rules live in the service.
 */
export class DirectoryController {
  protected readonly directories = $repository(archiveDirectories);
  protected readonly folios = $repository(folios);
  protected readonly blobs = $repository(archiveBlobs);
  protected readonly directoryService = $inject(ArchiveDirectoryService);
  protected readonly security = $inject(AppSecurityProvider);

  /**
   * List the immediate children of `parentDirectoryId` (or the
   * campaign root when omitted). Mixed contents — folios + blobs +
   * sub-directories under a single `entries` array, each tagged with
   * `kind`. That's the natural Drive-like response: the UI renders
   * them in one table.
   */
  listContents = $action({
    use: [$secure({ permissions: ["folio:read"] })],
    path: "/campaigns/:campaignId/archive/contents",
    description: "List directories + folios + blobs in a directory (or root).",
    schema: {
      params: t.object({ campaignId: t.integer() }),
      query: t.object({
        parentId: t.optional(t.uuid()),
      }),
      response: t.object({
        directory: t.optional(archiveDirectories.schema),
        breadcrumb: t.array(
          t.object({
            id: t.uuid(),
            shortId: t.integer(),
            name: t.string(),
          }),
        ),
        entries: t.array(
          t.object({
            kind: t.enum(["directory", "folio", "blob"]),
            id: t.string(),
            shortId: t.integer(),
            name: t.string(),
            updatedAt: t.string(),
            // Folio extras (omitted on directory + blob)
            tags: t.optional(t.array(t.string())),
            protected: t.optional(t.boolean()),
            pinned: t.optional(t.boolean()),
            summary: t.optional(t.string()),
            // Blob extras (omitted on directory + folio)
            size: t.optional(t.number()),
            mimeType: t.optional(t.string()),
          }),
        ),
      }),
    },
    handler: async ({ params, query, user }) => {
      await this.security.assertMember(params.campaignId, user);
      const directory = query.parentId
        ? await this.directoryService.findById(query.parentId)
        : undefined;
      if (
        query.parentId &&
        (!directory || directory.campaignId !== params.campaignId)
      ) {
        throw new NotFoundError("Directory not found");
      }

      const [childDirs, childFolios, childBlobs] = await Promise.all([
        this.directoryService.listChildren(params.campaignId, query.parentId),
        this.folios.findMany({
          where: query.parentId
            ? { directoryId: { eq: query.parentId } }
            : {
                campaignId: { eq: params.campaignId },
                directoryId: { isNull: true },
              },
          orderBy: [{ column: "title", direction: "asc" }],
        }),
        this.blobs.findMany({
          where: query.parentId
            ? { directoryId: { eq: query.parentId } }
            : {
                campaignId: { eq: params.campaignId },
                directoryId: { isNull: true },
              },
          orderBy: [{ column: "name", direction: "asc" }],
        }),
      ]);

      // Blob `size` / `mimeType` aren't hydrated here — clients that
      // need them fetch via `BlobController.getBlob` (or `blob_get`).
      // Folding the framework `files` join into this multi-table query
      // bloats the response for users browsing a deep tree.

      // Breadcrumb: walk up from the current directory.
      const breadcrumb: { id: string; shortId: number; name: string }[] = [];
      let cursor: string | undefined = directory?.parentId;
      const seen = new Set<string>();
      while (cursor && !seen.has(cursor)) {
        seen.add(cursor);
        const node = await this.directoryService.findById(cursor);
        if (!node) break;
        breadcrumb.unshift({
          id: node.id,
          shortId: node.shortId,
          name: node.name,
        });
        cursor = node.parentId;
      }

      const entries = [
        ...childDirs.map((d) => ({
          kind: "directory" as const,
          id: d.id,
          shortId: d.shortId,
          name: d.name,
          updatedAt: d.updatedAt,
        })),
        ...childFolios.map((f) => ({
          kind: "folio" as const,
          id: f.id,
          shortId: f.shortId,
          name: f.title,
          updatedAt: f.updatedAt,
          tags: f.tags ?? [],
          protected: f.protected,
          pinned: f.pinned,
          summary: f.summary || undefined,
        })),
        ...childBlobs.map((b) => ({
          kind: "blob" as const,
          id: b.fileId,
          shortId: b.shortId,
          name: b.name,
          updatedAt: b.updatedAt,
        })),
      ];

      return { directory, breadcrumb, entries };
    },
  });

  /**
   * Campaign-wide name search across folios + blobs + directories.
   * Powers the Archive page's top search bar. Case-insensitive
   * substring match against name (blobs/dirs) and `searchText`
   * (folios — title + tags + summary + content). Capped at 50 results
   * per kind so the response stays small.
   *
   * Returns the same Entry shape as `listContents` so the table
   * renders search results without a separate UI path.
   */
  searchArchive = $action({
    use: [$secure({ permissions: ["folio:read"] })],
    path: "/campaigns/:campaignId/archive/search",
    description:
      "Search folios + blobs + directories by name (and folio body).",
    schema: {
      params: t.object({ campaignId: t.integer() }),
      query: t.object({ q: t.string({ minLength: 1 }) }),
      response: t.object({
        entries: t.array(
          t.object({
            kind: t.enum(["directory", "folio", "blob"]),
            id: t.string(),
            shortId: t.integer(),
            name: t.string(),
            updatedAt: t.string(),
            tags: t.optional(t.array(t.string())),
            pinned: t.optional(t.boolean()),
            protected: t.optional(t.boolean()),
            summary: t.optional(t.string()),
            size: t.optional(t.number()),
          }),
        ),
      }),
    },
    handler: async ({ params, query, user }) => {
      await this.security.assertMember(params.campaignId, user);
      const needle = `%${query.q.toLowerCase()}%`;
      const [dirs, folioRows, blobRows] = await Promise.all([
        this.directories.findMany({
          where: {
            campaignId: { eq: params.campaignId },
            name: { like: `%${query.q}%` },
          },
          orderBy: [{ column: "name", direction: "asc" }],
          limit: 50,
        }),
        this.folios.findMany({
          where: {
            campaignId: { eq: params.campaignId },
            searchText: { like: needle },
          },
          orderBy: [
            { column: "pinned", direction: "desc" },
            { column: "updatedAt", direction: "desc" },
          ],
          limit: 50,
        }),
        this.blobs.findMany({
          where: {
            campaignId: { eq: params.campaignId },
            name: { like: `%${query.q}%` },
          },
          orderBy: [{ column: "updatedAt", direction: "desc" }],
          limit: 50,
        }),
      ]);
      return {
        entries: [
          ...dirs.map((d) => ({
            kind: "directory" as const,
            id: d.id,
            shortId: d.shortId,
            name: d.name,
            updatedAt: d.updatedAt,
          })),
          ...folioRows.map((f) => ({
            kind: "folio" as const,
            id: f.id,
            shortId: f.shortId,
            name: f.title,
            updatedAt: f.updatedAt,
            tags: f.tags ?? [],
            pinned: f.pinned,
            protected: f.protected,
            summary: f.summary || undefined,
          })),
          ...blobRows.map((b) => ({
            kind: "blob" as const,
            id: b.fileId,
            shortId: b.shortId,
            name: b.name,
            updatedAt: b.updatedAt,
          })),
        ],
      };
    },
  });

  /**
   * Return every archive directory in the campaign, flattened. Used
   * by the Archive UI's "Move" picker. Capped at 500 directories per
   * campaign (no UI scrolls a flat list past that).
   */
  listAllDirectories = $action({
    use: [$secure({ permissions: ["folio:read"] })],
    path: "/campaigns/:campaignId/archive/directories",
    description: "Flat list of every archive directory in the campaign.",
    schema: {
      params: t.object({ campaignId: t.integer() }),
      response: t.array(
        t.object({
          id: t.uuid(),
          shortId: t.integer(),
          name: t.string(),
          parentId: t.optional(t.uuid()),
        }),
      ),
    },
    handler: async ({ params, user }) => {
      await this.security.assertMember(params.campaignId, user);
      const rows = await this.directories.findMany({
        where: { campaignId: { eq: params.campaignId } },
        orderBy: [{ column: "name", direction: "asc" }],
        limit: 500,
      });
      return rows.map((d) => ({
        id: d.id,
        shortId: d.shortId,
        name: d.name,
        parentId: d.parentId,
      }));
    },
  });

  /**
   * Look up an archive directory by per-campaign shortId. Member-only.
   * Used by the MCP `directory_*` tools to resolve `directory_shortId`
   * params, and by the Archive UI to translate URL `?dir=<n>` into a
   * UUID.
   */
  getDirectoryByShortId = $action({
    use: [$secure({ permissions: ["folio:read"] })],
    path: "/campaigns/:campaignId/archive/directories/:shortId",
    description: "Look up an archive directory by per-campaign shortId.",
    schema: {
      params: t.object({
        campaignId: t.integer(),
        shortId: t.integer(),
      }),
      response: archiveDirectories.schema,
    },
    handler: async ({ params, user }) => {
      await this.security.assertMember(params.campaignId, user);
      const directory = await this.directoryService.findByShortId(
        params.campaignId,
        params.shortId,
      );
      if (!directory) throw new NotFoundError("Directory not found");
      return directory;
    },
  });

  createDirectory = $action({
    use: [$secure({ permissions: ["folio:write"] }), $transactional()],
    path: "/campaigns/:campaignId/archive/directories",
    description: "Create a new archive directory.",
    schema: {
      params: t.object({ campaignId: t.integer() }),
      body: t.object({
        name: t.string({ minLength: 1, maxLength: 200 }),
        parentId: t.optional(t.uuid()),
      }),
      response: archiveDirectories.schema,
    },
    handler: async ({ params, body, user }) => {
      await this.security.assertMember(params.campaignId, user);
      return this.directoryService.create({
        campaignId: params.campaignId,
        name: body.name,
        parentId: body.parentId,
      });
    },
  });

  renameDirectory = $action({
    use: [$secure({ permissions: ["folio:write"] }), $transactional()],
    path: "/archive/directories/:id/rename",
    description: "Rename an archive directory.",
    schema: {
      params: t.object({ id: t.uuid() }),
      body: t.object({ name: t.string({ minLength: 1, maxLength: 200 }) }),
      response: archiveDirectories.schema,
    },
    handler: async ({ params, body, user }) => {
      const directory = await this.directoryService.findById(params.id);
      if (!directory) throw new NotFoundError("Directory not found");
      await this.security.assertMember(directory.campaignId, user);
      return this.directoryService.rename(params.id, body.name);
    },
  });

  moveDirectory = $action({
    use: [$secure({ permissions: ["folio:write"] }), $transactional()],
    path: "/archive/directories/:id/move",
    description: "Move an archive directory under a new parent (or to root).",
    schema: {
      params: t.object({ id: t.uuid() }),
      body: t.object({
        // null/omitted → move to campaign root.
        parentId: t.optional(t.uuid()),
      }),
      response: archiveDirectories.schema,
    },
    handler: async ({ params, body, user }) => {
      const directory = await this.directoryService.findById(params.id);
      if (!directory) throw new NotFoundError("Directory not found");
      await this.security.assertMember(directory.campaignId, user);
      return this.directoryService.move(params.id, body.parentId);
    },
  });

  deleteDirectory = $action({
    use: [$secure({ permissions: ["folio:write"] }), $transactional()],
    path: "/archive/directories/:id",
    description:
      "Delete an archive directory. Pass cascade=true for non-empty.",
    schema: {
      params: t.object({ id: t.uuid() }),
      query: t.object({ cascade: t.optional(t.boolean()) }),
      response: okSchema,
    },
    handler: async ({ params, query, user }) => {
      const directory = await this.directoryService.findById(params.id);
      if (!directory) throw new NotFoundError("Directory not found");
      await this.security.assertMember(directory.campaignId, user);
      await this.directoryService.delete(params.id, {
        cascade: query.cascade === true,
      });
      return { ok: true };
    },
  });
}
