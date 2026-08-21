import { $inject, z } from "alepha";
import { $tool } from "alepha/mcp";
import { BadRequestError, NotFoundError } from "alepha/server";
import { BlobController } from "../../api/controllers/BlobController.ts";
import { DirectoryController } from "../../api/controllers/DirectoryController.ts";
import { FolioController } from "../../api/controllers/FolioController.ts";
import { ProjectController } from "../../api/controllers/ProjectController.ts";
import { FolioLinkService } from "../../api/services/FolioLinkService.ts";
import { DIAGRAM_CAPABILITY } from "../schemas/diagramCapability.ts";
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
 * MCP tools for Folios — project-shared markdown notes that act as the
 * AI memory for a project. Mirrors the per-repo `MEMORY.md` convention
 * but scoped to a Lore project so every member (humans + agents) sees
 * and co-curates the same set.
 *
 * Designed for AI-first workflows: `folio_search` returns a snippet so the
 * model can disambiguate without a follow-up read; every call requires
 * a `project` (or `project_name`) to scope reads/writes. For situational
 * awareness across a whole project, prefer the orientation tool
 * `project_context` — it returns the folio index alongside active quests
 * in one ~2K-token call.
 *
 * Also declares the `directory_*` and `blob_*` tools (quest #66): folios
 * live in a per-project directory tree alongside binary blob
 * attachments, so browsing and organizing that tree is part of the same
 * surface as the folios it holds.
 */
export class FolioTools {
  protected readonly folioController = $inject(FolioController);
  protected readonly projectController = $inject(ProjectController);
  protected readonly directoryController = $inject(DirectoryController);
  protected readonly folioLinkService = $inject(FolioLinkService);
  protected readonly blobController = $inject(BlobController);

  /**
   * Resolve project ID from params (by ID or name). Required: at least one
   * must be provided, since folios are now scoped to a project.
   */
  protected async resolveProjectId(
    project?: number,
    project_name?: string,
  ): Promise<number> {
    const projects = await this.projectController.getMyProjects();

    if (project) {
      const found = projects.find((p) => p.id === project);
      if (!found) {
        throw new NotFoundError(`Project with ID ${project} not found`);
      }
      return found.id;
    }

    if (project_name) {
      const found = projects.find(
        (p) => p.title.toLowerCase() === project_name.toLowerCase(),
      );
      if (!found) {
        throw new NotFoundError(`Project "${project_name}" not found`);
      }
      return found.id;
    }

    throw new BadRequestError(
      "Project is required. Specify project ID or project_name.",
    );
  }

  /**
   * Accept either a global UUID `id` or a per-project `shortId` reference
   * (with `project` / `project_name`) and return the global folio id.
   */
  protected async resolveFolioId(params: {
    id?: string;
    shortId?: number;
    project?: number;
    project_name?: string;
  }): Promise<string> {
    if (params.id != null) return params.id;
    if (params.shortId != null) {
      const projectId = await this.resolveProjectId(
        params.project,
        params.project_name,
      );
      const folio = await this.folioController.getByShortId({
        params: { projectId, shortId: params.shortId },
      });
      return folio.id;
    }
    throw new BadRequestError(
      "Folio reference required: pass `id` (global UUID) or `shortId` (per-project — also requires `project` or `project_name`).",
    );
  }

  // Folios live inside `folio_directories` (quest #66); use the
  // `directory_*` MCP tools to navigate the tree.

  /**
   * Resolve a `directory_shortId` MCP input to the global directory
   * UUID, scoped to the given project. Throws `NotFoundError` via the
   * underlying controller endpoint if the directory doesn't exist or
   * the caller isn't a member of the project.
   */
  protected async resolveDirectoryShortId(
    shortId: number | undefined,
    projectId: number,
  ): Promise<string | undefined> {
    if (shortId === undefined) return undefined;
    const directory = await this.directoryController.getDirectoryByShortId({
      params: { projectId, shortId },
    });
    return directory.id;
  }

  /**
   * Resolve a `blob_shortId` MCP input to the global file UUID, scoped to
   * the given project. Delegates to a public controller endpoint — no
   * reach into private state.
   */
  protected async resolveBlobFileId(
    projectId: number,
    shortId: number,
  ): Promise<string> {
    const blob = await this.blobController.getBlobByShortId({
      params: { projectId, shortId },
    });
    return blob.id;
  }

  folio_list = $tool({
    description:
      "List the project's folios (markdown notes that act as the project's shared memory), newest first. Returns id, title, summary, updatedAt — call `folio_get` to read full content. For initial orientation on a project, prefer `project_context` — it returns this same index alongside the active quests in one round-trip.",
    title: "List folios",
    annotations: {
      readOnlyHint: true,
      idempotentHint: true,
    },
    schema: {
      params: z.object({
        project: z.integer().optional(),
        project_name: z.string().optional(),
        limit: z.integer().min(1).max(100).default(20).optional(),
      }),
      result: z.object({
        folios: z.array(folioRefSchema),
      }),
    },
    handler: async ({ params }) => {
      const projectId = await this.resolveProjectId(
        params.project,
        params.project_name,
      );
      const folios = await this.folioController.list({
        query: { limit: params.limit ?? 20, projectId },
      });
      return {
        folios: folios.map((f) => ({
          id: f.id,
          shortId: f.shortId,
          title: f.title,
          summary: f.summary || undefined,
          updatedAt: f.updatedAt,
        })),
      };
    },
  });

  folio_search = $tool({
    description:
      "Search the project's folios by free-text query (matches title, summary and content, case-insensitive). Returns id/title + a ~200-char snippet around the match — use this before folio_get when looking something up.",
    title: "Search folios",
    annotations: {
      readOnlyHint: true,
      idempotentHint: true,
    },
    schema: {
      params: z.object({
        query: z.string().min(1),
        project: z.integer().optional(),
        project_name: z.string().optional(),
        limit: z.integer().min(1).max(50).default(10).optional(),
      }),
      result: z.object({
        results: z.array(
          z.object({
            id: z.uuid(),
            shortId: z.integer(),
            title: z.string(),
            snippet: z.string(),
            updatedAt: z.string(),
          }),
        ),
      }),
    },
    handler: async ({ params }) => {
      const projectId = await this.resolveProjectId(
        params.project,
        params.project_name,
      );
      const folios = await this.folioController.list({
        query: {
          q: params.query,
          limit: params.limit ?? 10,
          projectId,
        },
      });
      return {
        results: folios.map((f) => ({
          id: f.id,
          shortId: f.shortId,
          title: f.title,
          snippet: buildSnippet(f.content, params.query),
          updatedAt: f.updatedAt,
        })),
      };
    },
  });

  folio_get = $tool({
    description:
      "Get the full content of a folio (markdown) plus its wiki-style links — `outbound` (folios this one references via `[[...]]`) and `inbound` (folios that link back here). Outbound entries also include `quest` and `blob` kinds when the folio references quests (`[[quest:#N]]`) or blobs (`[[blob:#N]]`, `[[blob:<uuid>]]`, or `![alt](blob:#N)`). Use the `inbound` list as a backlink panel: it surfaces folios that may carry related context. Accepts either the global UUID `id` or the per-project `shortId` (with `project` / `project_name`).",
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
      "Create a new folio in a project — a markdown note that becomes part of the project's memory for AI agents. Provide `project` (id) or `project_name`. `content` is markdown. **Always set `summary`** — a 1-2 sentence (~200 chars) description of what the folio is for. It's the field other agents (and future calls of yours) read in `project_context` to decide whether to fetch the body. Without a summary, the index falls back to the title and orientation suffers. " +
      DIAGRAM_CAPABILITY,
    title: "Create folio",
    annotations: { readOnlyHint: false, destructiveHint: false },
    schema: {
      params: z.object({
        project: z.integer().optional(),
        project_name: z.string().optional(),
        title: z.string().min(1).max(200),
        content: z.string().optional(),
        summary: z
          .string()
          .max(500)
          .describe(
            "1-2 sentence description of what the folio is for. Surfaced via `project_context`. Strongly recommended — without it, agents must fetch the body to orient.",
          )
          .optional(),
        directory_shortId: z
          .integer()
          .describe(
            "Place the folio in this directory (by per-project shortId). Omit to create at the project root. Directories organize folios into a tree (#66) — list available ones via `directory_list`.",
          )
          .optional(),
        pinned: z
          .boolean()
          .describe(
            "Pin the folio. Pinned folios sort to the top of `folio_list` AND have their full content surfaced in `project_context` — they're the per-project equivalent of CLAUDE.md / AGENTS.md. Per-project pin (one shared pin set per project). Use sparingly: the 8K-char total budget across all pinned folios is consumed every time an agent calls `project_context`.",
          )
          .optional(),
      }),
      result: folioFullSchema,
    },
    handler: async ({ params }) => {
      const projectId = await this.resolveProjectId(
        params.project,
        params.project_name,
      );
      const directoryId = await this.resolveDirectoryShortId(
        params.directory_shortId,
        projectId,
      );
      const folio = await this.folioController.create({
        body: {
          projectId,
          title: params.title,
          content: params.content,
          summary: params.summary,
          directoryId: directoryId ?? undefined,
          pinned: params.pinned,
        },
      });
      return {
        id: folio.id,
        shortId: folio.shortId,
        title: folio.title,
        summary: folio.summary || undefined,
        content: folio.content,
        createdAt: folio.createdAt,
        updatedAt: folio.updatedAt,
      };
    },
  });

  folio_update = $tool({
    description:
      "Update a folio. Any omitted field stays unchanged. Updating `content` is a good moment to also refresh `summary` so the orientation index in `project_context` stays accurate. " +
      DIAGRAM_CAPABILITY,
    title: "Update folio",
    annotations: { readOnlyHint: false, idempotentHint: true },
    schema: {
      params: folioRefParamsSchema.extend({
        title: z.string().min(1).max(200).optional(),
        content: z.string().optional(),
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
            "Move the folio into this directory (per-project shortId). Omit to leave the directory untouched. Pass 0 to move the folio to the project root.",
          )
          .optional(),
        pinned: z
          .boolean()
          .describe(
            "Pin or unpin the folio. Pinned folios surface their full content in `project_context` (capped at 8K chars total across all pinned). Omit to leave the current state untouched.",
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
        const projectId = await this.resolveProjectId(
          params.project,
          params.project_name,
        );
        directoryId = await this.resolveDirectoryShortId(
          params.directory_shortId,
          projectId,
        );
      }
      const folio = await this.folioController.update({
        params: { id },
        body: {
          title: params.title,
          content: params.content,
          summary: params.summary,
          directoryId,
          pinned: params.pinned,
        },
      });
      return {
        id: folio.id,
        shortId: folio.shortId,
        title: folio.title,
        summary: folio.summary || undefined,
        content: folio.content,
        createdAt: folio.createdAt,
        updatedAt: folio.updatedAt,
      };
    },
  });

  folio_history = $tool({
    description:
      "List the revision history of a folio (newest first). Each entry includes `action` (create / edit / rename / revert — plus the retired `tag-change` on rows written before folio tags were removed), `at` timestamp, the user who made the change, and a snapshot of the folio's title/content/summary at the time. Capped at 10 revisions per folio by default (oldest non-pinned drop off when the cap is exceeded). Use this to see how a folio evolved, then `folio_revert` to roll back if needed.",
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
        summary: folio.summary || undefined,
        content: folio.content,
        createdAt: folio.createdAt,
        updatedAt: folio.updatedAt,
      };
    },
  });

  folio_links_tidy = $tool({
    description:
      "Walk every folio in the project and rewrite stale `[[dir/sub/name]]` path tokens whose path no longer matches the target folio's current location. Only touches folio-type, slash-bearing, non-shortId refs that still resolve to a real folio; dangling references and `[[#N]]` / bare title refs are left alone. Targets at the project root get their path stripped (`[[name]]`); targets inside a directory get the full current chain (`[[dir/sub/name]]`). Preserves any `folio:` prefix and `#anchor` suffix verbatim. Each rewritten folio is saved as a single edit (one `folio_revisions` row). Pass `dryRun: true` to preview the change set without writing.",
    title: "Tidy stale folio path links",
    annotations: { destructiveHint: false, idempotentHint: true },
    schema: {
      params: z.object({
        project: z.integer().optional(),
        project_name: z.string().optional(),
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
      const projectId = await this.resolveProjectId(
        params.project,
        params.project_name,
      );
      const dryRun = params.dryRun === true;
      return this.folioLinkService.tidyStalePaths(projectId, {
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

  // ---------------------------------------------------------------------------
  // directory_* tools
  // ---------------------------------------------------------------------------

  directory_list = $tool({
    description:
      "List the contents of a directory (folios + blobs + child directories) in one call. Pass `directory_shortId` to drill in, or omit for the project root. Returns the directory metadata, the breadcrumb (root → … → parent), and `entries` tagged by `kind`. This is the Drive-like browse endpoint for AI agents.",
    title: "List directory contents",
    annotations: { readOnlyHint: true, idempotentHint: true },
    schema: {
      params: z.object({
        project: z.integer().optional(),
        project_name: z.string().optional(),
        directory_shortId: z.integer().optional(),
      }),
      result: z.object({
        directory_shortId: z.integer().optional(),
        breadcrumb: z.array(
          z.object({ shortId: z.integer(), name: z.string() }),
        ),
        entries: z.array(
          z.object({
            kind: z.enum(["directory", "folio", "blob"]),
            shortId: z.integer(),
            name: z.string(),
            updatedAt: z.string(),
          }),
        ),
      }),
    },
    handler: async ({ params }) => {
      const projectId = await this.resolveProjectId(
        params.project,
        params.project_name,
      );
      const parentId = await this.resolveDirectoryShortId(
        params.directory_shortId,
        projectId,
      );
      const result = await this.directoryController.listContents({
        params: { projectId },
        query: { parentId },
      });
      return {
        directory_shortId: result.directory?.shortId,
        breadcrumb: result.breadcrumb.map((b) => ({
          shortId: b.shortId,
          name: b.name,
        })),
        entries: result.entries.map((e) => ({
          kind: e.kind,
          shortId: e.shortId,
          name: e.name,
          updatedAt: e.updatedAt,
        })),
      };
    },
  });

  directory_create = $tool({
    description:
      "Create a new directory. Drive-style auto-suffix on name collision (`name (1)`, `name (2)`, ...).",
    title: "Create directory",
    annotations: { destructiveHint: false },
    schema: {
      params: z.object({
        project: z.integer().optional(),
        project_name: z.string().optional(),
        name: z.string().min(1).max(200),
        parent_shortId: z.integer().optional(),
      }),
      result: z.object({
        id: z.uuid(),
        shortId: z.integer(),
        name: z.string(),
      }),
    },
    handler: async ({ params }) => {
      const projectId = await this.resolveProjectId(
        params.project,
        params.project_name,
      );
      const parentId = await this.resolveDirectoryShortId(
        params.parent_shortId,
        projectId,
      );
      const created = await this.directoryController.createDirectory({
        params: { projectId },
        body: { name: params.name, parentId },
      });
      return {
        id: created.id,
        shortId: created.shortId,
        name: created.name,
      };
    },
  });

  directory_rename = $tool({
    description: "Rename a directory (auto-suffix on collision).",
    title: "Rename directory",
    annotations: { idempotentHint: true, destructiveHint: false },
    schema: {
      params: z.object({
        project: z.integer().optional(),
        project_name: z.string().optional(),
        directory_shortId: z.integer(),
        name: z.string().min(1).max(200),
      }),
      result: z.object({ shortId: z.integer(), name: z.string() }),
    },
    handler: async ({ params }) => {
      const projectId = await this.resolveProjectId(
        params.project,
        params.project_name,
      );
      const id = await this.resolveDirectoryShortId(
        params.directory_shortId,
        projectId,
      );
      if (!id) throw new NotFoundError("Directory not found");
      const updated = await this.directoryController.renameDirectory({
        params: { id },
        body: { name: params.name },
      });
      return { shortId: updated.shortId, name: updated.name };
    },
  });

  directory_move = $tool({
    description:
      "Move a directory under a new parent (or to the project root). Refuses to create cycles.",
    title: "Move directory",
    annotations: { idempotentHint: true, destructiveHint: false },
    schema: {
      params: z.object({
        project: z.integer().optional(),
        project_name: z.string().optional(),
        directory_shortId: z.integer(),
        new_parent_shortId: z.integer().optional(),
      }),
      result: z.object({ shortId: z.integer(), name: z.string() }),
    },
    handler: async ({ params }) => {
      const projectId = await this.resolveProjectId(
        params.project,
        params.project_name,
      );
      const id = await this.resolveDirectoryShortId(
        params.directory_shortId,
        projectId,
      );
      if (!id) throw new NotFoundError("Directory not found");
      const parentId = await this.resolveDirectoryShortId(
        params.new_parent_shortId,
        projectId,
      );
      const updated = await this.directoryController.moveDirectory({
        params: { id },
        body: { parentId },
      });
      return { shortId: updated.shortId, name: updated.name };
    },
  });

  directory_delete = $tool({
    description:
      "Delete a directory. Refuses if not empty unless `cascade: true` — cascade recursively wipes the subtree (folios + blobs + sub-directories) via the DB cascade.",
    title: "Delete directory",
    annotations: { destructiveHint: true },
    schema: {
      params: z.object({
        project: z.integer().optional(),
        project_name: z.string().optional(),
        directory_shortId: z.integer(),
        cascade: z.boolean().optional(),
      }),
      result: z.object({ ok: z.boolean() }),
    },
    handler: async ({ params }) => {
      const projectId = await this.resolveProjectId(
        params.project,
        params.project_name,
      );
      const id = await this.resolveDirectoryShortId(
        params.directory_shortId,
        projectId,
      );
      if (!id) throw new NotFoundError("Directory not found");
      await this.directoryController.deleteDirectory({
        params: { id },
        query: { cascade: params.cascade },
      });
      return { ok: true };
    },
  });

  // ---------------------------------------------------------------------------
  // blob_* tools
  //
  // Blob *uploads* are out of MCP scope for v1 — agents can't post bytes
  // efficiently through the JSON-RPC channel. The list / rename / move /
  // delete tools are the meaningful surface: agents inspect what
  // humans uploaded, organize it, and embed it inline via the markdown
  // embed syntax (`![alt](blob:#N)` — quest #67).
  // ---------------------------------------------------------------------------

  blob_list = $tool({
    description:
      "List the attachments of one folio. Each entry includes shortId, name, size, mimeType, and the optional sha256 + originalName.",
    title: "List blobs",
    annotations: { readOnlyHint: true, idempotentHint: true },
    schema: {
      params: z.object({
        project: z.integer().optional(),
        project_name: z.string().optional(),
        folio_shortId: z.integer(),
      }),
      result: z.object({
        blobs: z.array(
          z.object({
            shortId: z.integer(),
            name: z.string(),
            size: z.number(),
            mimeType: z.string(),
            sha256: z.string().optional(),
            originalName: z.string().optional(),
            updatedAt: z.string(),
          }),
        ),
      }),
    },
    handler: async ({ params }) => {
      const projectId = await this.resolveProjectId(
        params.project,
        params.project_name,
      );
      const folioId = await this.resolveFolioId({
        shortId: params.folio_shortId,
        project: projectId,
      });
      const blobs = await this.blobController.listBlobs({
        params: { folioId },
      });
      return {
        blobs: blobs.map((b) => ({
          shortId: b.shortId,
          name: b.name,
          size: b.size,
          mimeType: b.mimeType,
          sha256: b.sha256,
          originalName: b.originalName,
          updatedAt: b.updatedAt,
        })),
      };
    },
  });

  blob_rename = $tool({
    description: "Rename a blob (auto-suffix on collision).",
    title: "Rename blob",
    annotations: { idempotentHint: true, destructiveHint: false },
    schema: {
      params: z.object({
        project: z.integer().optional(),
        project_name: z.string().optional(),
        blob_shortId: z.integer(),
        name: z.string().min(1).max(200),
      }),
      result: z.object({ shortId: z.integer(), name: z.string() }),
    },
    handler: async ({ params }) => {
      const projectId = await this.resolveProjectId(
        params.project,
        params.project_name,
      );
      const fileId = await this.resolveBlobFileId(
        projectId,
        params.blob_shortId,
      );
      const updated = await this.blobController.renameBlob({
        params: { id: fileId },
        body: { name: params.name },
      });
      return { shortId: updated.shortId, name: updated.name };
    },
  });

  blob_delete = $tool({
    description: "Delete a blob and reclaim its storage.",
    title: "Delete blob",
    annotations: { destructiveHint: true },
    schema: {
      params: z.object({
        project: z.integer().optional(),
        project_name: z.string().optional(),
        blob_shortId: z.integer(),
      }),
      result: z.object({ ok: z.boolean() }),
    },
    handler: async ({ params }) => {
      const projectId = await this.resolveProjectId(
        params.project,
        params.project_name,
      );
      const fileId = await this.resolveBlobFileId(
        projectId,
        params.blob_shortId,
      );
      await this.blobController.deleteBlob({ params: { id: fileId } });
      return { ok: true };
    },
  });
}
