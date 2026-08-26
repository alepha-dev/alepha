import { $inject, z } from "alepha";
import { $repository, $transactional } from "alepha/orm";
import { $secure } from "alepha/security";
import { $action, NotFoundError, okSchema } from "alepha/server";

import { folioBlobs } from "../entities/folioBlobs.ts";
import { folioDirectories } from "../entities/folioDirectories.ts";
import { folios } from "../entities/folios.ts";
import { FolioDirectoryService } from "../services/FolioDirectoryService.ts";
import { ProjectSecurityService } from "../services/ProjectSecurityService.ts";

/**
 * REST surface for the Folio directory tree. Reads scoped via
 * `assertMember`; mutations also `assertMember` (project-shared, per
 * folio #4 Q2). Cycle / depth / uniqueness rules live in the service.
 */
export class DirectoryController {
  protected readonly directories = $repository(folioDirectories);
  protected readonly folios = $repository(folios);
  protected readonly blobs = $repository(folioBlobs);
  protected readonly directoryService = $inject(FolioDirectoryService);
  protected readonly security = $inject(ProjectSecurityService);

  /**
   * List the immediate children of `parentDirectoryId` (or the
   * project root when omitted). Mixed contents - folios +
   * sub-directories under a single `entries` array, each tagged with
   * `kind`. That's the natural Drive-like response: the UI renders
   * them in one table.
   *
   * Attachments are not children of a folder. They belong to one folio,
   * and `folio_blobs.directoryId` has been dead since that became true,
   * so the blob query this used to run always came back empty and every
   * caller was reading a `"blob"` entry kind that could not occur. To
   * list a folio's attachments, ask `BlobController`.
   */
  listContents = $action({
    use: [$secure({ permissions: ["folio:read"] })],
    path: "/projects/:projectId/folio/contents",
    description: "List directories + folios in a directory (or root).",
    schema: {
      params: z.object({ projectId: z.integer() }),
      query: z.object({
        parentId: z.uuid().optional(),
      }),
      response: z.object({
        directory: folioDirectories.schema.optional(),
        breadcrumb: z.array(
          z.object({
            id: z.uuid(),
            shortId: z.integer(),
            name: z.string(),
          }),
        ),
        entries: z.array(
          z.object({
            kind: z.enum(["directory", "folio"]),
            id: z.string(),
            shortId: z.integer(),
            name: z.string(),
            updatedAt: z.string(),
            // Folio extras (omitted on directory)
            tags: z.array(z.string()).optional(),
            protected: z.boolean().optional(),
            pinned: z.boolean().optional(),
            summary: z.string().optional(),
          }),
        ),
      }),
    },
    handler: async ({ params, query, user }) => {
      await this.security.assertMember(params.projectId, user);
      const directory = query.parentId
        ? await this.directoryService.findById(query.parentId)
        : undefined;
      if (
        query.parentId &&
        (!directory || directory.projectId !== params.projectId)
      ) {
        throw new NotFoundError("Directory not found");
      }

      const [childDirs, childFolios] = await Promise.all([
        this.directoryService.listChildren(params.projectId, query.parentId),
        this.folios.findMany({
          where: query.parentId
            ? { directoryId: { eq: query.parentId } }
            : {
                projectId: { eq: params.projectId },
                directoryId: { isNull: true },
              },
          orderBy: [{ column: "title", direction: "asc" }],
        }),
      ]);

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
      ];

      return { directory, breadcrumb, entries };
    },
  });

  /**
   * Project-wide name search across folios + blobs + directories.
   * Powers the Folio page's top search bar. Case-insensitive
   * substring match against name (blobs/dirs) and `searchText`
   * (folios — title + tags + summary + content). Capped at 50 results
   * per kind so the response stays small.
   *
   * Returns the `listContents` Entry shape widened with `"blob"`: an
   * attachment is not a child of any folder, so it can never appear in
   * a listing, but finding one by name across the project is exactly
   * what a search is for.
   */
  searchFolio = $action({
    use: [$secure({ permissions: ["folio:read"] })],
    path: "/projects/:projectId/folio/search",
    description:
      "Search folios + blobs + directories by name (and folio body).",
    schema: {
      params: z.object({ projectId: z.integer() }),
      query: z.object({ q: z.string().min(1) }),
      response: z.object({
        entries: z.array(
          z.object({
            kind: z.enum(["directory", "folio", "blob"]),
            id: z.string(),
            shortId: z.integer(),
            name: z.string(),
            updatedAt: z.string(),
            tags: z.array(z.string()).optional(),
            pinned: z.boolean().optional(),
            protected: z.boolean().optional(),
            summary: z.string().optional(),
            size: z.number().optional(),
          }),
        ),
      }),
    },
    handler: async ({ params, query, user }) => {
      await this.security.assertMember(params.projectId, user);
      const needle = `%${query.q.toLowerCase()}%`;
      const [dirs, folioRows, blobRows] = await Promise.all([
        this.directories.findMany({
          where: {
            projectId: { eq: params.projectId },
            name: { like: `%${query.q}%` },
          },
          orderBy: [{ column: "name", direction: "asc" }],
          limit: 50,
        }),
        this.folios.findMany({
          where: {
            projectId: { eq: params.projectId },
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
            projectId: { eq: params.projectId },
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
   * Return every folio directory in the project, flattened. Used
   * by the Folio UI's "Move" picker. Capped at 500 directories per
   * project (no UI scrolls a flat list past that).
   */
  listAllDirectories = $action({
    use: [$secure({ permissions: ["folio:read"] })],
    path: "/projects/:projectId/folio/directories",
    description: "Flat list of every folio directory in the project.",
    schema: {
      params: z.object({ projectId: z.integer() }),
      response: z.array(
        z.object({
          id: z.uuid(),
          shortId: z.integer(),
          name: z.string(),
          parentId: z.uuid().optional(),
        }),
      ),
    },
    handler: async ({ params, user }) => {
      await this.security.assertMember(params.projectId, user);
      const rows = await this.directories.findMany({
        where: { projectId: { eq: params.projectId } },
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
   * Look up a folio directory by per-project shortId. Member-only.
   * Used by the MCP `directory_*` tools to resolve `directory_shortId`
   * params, and by the Folio UI to translate URL `?dir=<n>` into a
   * UUID.
   */
  getDirectoryByShortId = $action({
    use: [$secure({ permissions: ["folio:read"] })],
    path: "/projects/:projectId/folio/directories/:shortId",
    description: "Look up a folio directory by per-project shortId.",
    schema: {
      params: z.object({
        projectId: z.integer(),
        shortId: z.integer(),
      }),
      response: folioDirectories.schema,
    },
    handler: async ({ params, user }) => {
      await this.security.assertMember(params.projectId, user);
      const directory = await this.directoryService.findByShortId(
        params.projectId,
        params.shortId,
      );
      if (!directory) throw new NotFoundError("Directory not found");
      return directory;
    },
  });

  createDirectory = $action({
    use: [$secure({ permissions: ["folio:write"] }), $transactional()],
    path: "/projects/:projectId/folio/directories",
    description: "Create a new folio directory.",
    schema: {
      params: z.object({ projectId: z.integer() }),
      body: z.object({
        name: z.string().min(1).max(200),
        parentId: z.uuid().optional(),
      }),
      response: folioDirectories.schema,
    },
    handler: async ({ params, body, user }) => {
      await this.security.assertMember(params.projectId, user);
      return this.directoryService.create({
        projectId: params.projectId,
        name: body.name,
        parentId: body.parentId,
      });
    },
  });

  renameDirectory = $action({
    use: [$secure({ permissions: ["folio:write"] }), $transactional()],
    path: "/folio/directories/:id/rename",
    description: "Rename a folio directory.",
    schema: {
      params: z.object({ id: z.uuid() }),
      body: z.object({ name: z.string().min(1).max(200) }),
      response: folioDirectories.schema,
    },
    handler: async ({ params, body, user }) => {
      const directory = await this.directoryService.findById(params.id);
      if (!directory) throw new NotFoundError("Directory not found");
      await this.security.assertMember(directory.projectId, user);
      return this.directoryService.rename(params.id, body.name);
    },
  });

  moveDirectory = $action({
    use: [$secure({ permissions: ["folio:write"] }), $transactional()],
    path: "/folio/directories/:id/move",
    description: "Move a folio directory under a new parent (or to root).",
    schema: {
      params: z.object({ id: z.uuid() }),
      body: z.object({
        // null/omitted → move to project root.
        parentId: z.uuid().optional(),
      }),
      response: folioDirectories.schema,
    },
    handler: async ({ params, body, user }) => {
      const directory = await this.directoryService.findById(params.id);
      if (!directory) throw new NotFoundError("Directory not found");
      await this.security.assertMember(directory.projectId, user);
      return this.directoryService.move(params.id, body.parentId);
    },
  });

  deleteDirectory = $action({
    use: [$secure({ permissions: ["folio:write"] }), $transactional()],
    path: "/folio/directories/:id",
    description: "Delete a folio directory. Pass cascade=true for non-empty.",
    schema: {
      params: z.object({ id: z.uuid() }),
      query: z.object({ cascade: z.boolean().optional() }),
      response: okSchema,
    },
    handler: async ({ params, query, user }) => {
      const directory = await this.directoryService.findById(params.id);
      if (!directory) throw new NotFoundError("Directory not found");
      await this.security.assertMember(directory.projectId, user);
      await this.directoryService.delete(params.id, {
        cascade: query.cascade === true,
      });
      return { ok: true };
    },
  });
}
