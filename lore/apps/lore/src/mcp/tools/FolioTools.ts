import { $inject, z } from "alepha";
import { $tool } from "alepha/mcp";
import { BadRequestError, NotFoundError } from "alepha/server";

import { DirectoryController } from "../../api/controllers/DirectoryController.ts";
import { EpicController } from "../../api/controllers/EpicController.ts";
import { FolioAttachmentController } from "../../api/controllers/FolioAttachmentController.ts";
import { FolioController } from "../../api/controllers/FolioController.ts";
import { ProjectController } from "../../api/controllers/ProjectController.ts";
// The one definition of an `assets/<name>` reference, shared with the editor
// so a path written by an agent and one written by a human are the same
// string. Precedent for reaching across: `FolioAttachmentService` imports it
// from here too. It is a pure function with no imports of its own.
import { folioAssetPath } from "../../web/app/components/folios/folioAssetReference.ts";
import { DIAGRAM_CAPABILITY } from "../schemas/diagramCapability.ts";
import {
  folioEpicRefSchema,
  folioFullSchema,
  folioRefParamsSchema,
  folioRefSchema,
} from "../schemas/index.ts";
import { AttachmentUploadService } from "../services/AttachmentUploadService.ts";
import { DiagramCheckService } from "../services/DiagramCheckService.ts";
import { EpicRefService } from "../services/EpicRefService.ts";
import { ProjectTools } from "./ProjectTools.ts";

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
 * Also declares the `directory_*` and `folio_attachment_*` tools (quest #66): folios
 * live in a per-project directory tree alongside binary attachments
 * attachments, so browsing and organizing that tree is part of the same
 * surface as the folios it holds.
 */
export class FolioTools {
  protected readonly folioController = $inject(FolioController);
  protected readonly projectController = $inject(ProjectController);
  protected readonly directoryController = $inject(DirectoryController);
  protected readonly attachmentController = $inject(FolioAttachmentController);
  protected readonly epicController = $inject(EpicController);
  protected readonly epicRefs = $inject(EpicRefService);
  protected readonly diagrams = $inject(DiagramCheckService);
  protected readonly attachmentUpload = $inject(AttachmentUploadService);
  protected readonly projectTools = $inject(ProjectTools);

  /**
   * Resolve project ID from params (by ID or name). Required: at least one
   * must be provided, since folios are now scoped to a project.
   */
  protected async resolveProjectId(
    project?: number,
    project_name?: string,
  ): Promise<number> {
    // One implementation, in `ProjectTools`. See the note there.
    return await this.projectTools.resolveProjectId(project, project_name);
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

  /**
   * Resolve an `epic_number` MCP input to the global epic id, scoped to the
   * given project. A read-only lookup; `EpicController.attachFolio` /
   * `detachFolio` are what then perform the move. Both are member-gated,
   * like every epic mutation and like folio creation itself.
   */
  protected async resolveEpicId(
    projectId: number,
    number: number,
  ): Promise<number> {
    const epic = await this.epicController.getEpicByNumber({
      params: { projectId, number },
    });
    return epic.id;
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
   * Resolve a `attachment_shortId` MCP input to the global file UUID, scoped to
   * the given project. Delegates to a public controller endpoint — no
   * reach into private state.
   */
  protected async resolveAttachmentFileId(
    projectId: number,
    shortId: number,
  ): Promise<string> {
    const attachment = await this.attachmentController.getAttachmentByShortId({
      params: { projectId, shortId },
    });
    return attachment.id;
  }

  folio_list = $tool({
    description:
      "List the project's folios (markdown notes that act as the project's shared memory), pinned first, then newest first. Returns id, title, summary, updatedAt and the `epic` the folio is filed under, if any — call `folio_get` to read full content. Pass `epic` to narrow the list to one epic's folios. For initial orientation on a project, prefer `project_context` — it returns this same index alongside the active quests in one round-trip.",
    title: "List folios",
    annotations: {
      readOnlyHint: true,
      idempotentHint: true,
    },
    schema: {
      params: z.object({
        project: z.integer().optional(),
        project_name: z.string().optional(),
        epic: z
          .integer()
          .describe(
            "Filter to the folios filed under one epic, by its global id (the `id` field from epic_list / epic_get, not the per-project `number`). `epic_get` returns the same list inline.",
          )
          .optional(),
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
        query: {
          limit: params.limit ?? 20,
          projectId,
          ...(params.epic != null ? { epicId: params.epic } : {}),
        },
      });
      // One extra call for the whole page rather than one per folio, the
      // same way quest_list stamps its rows.
      const epicRefs = await this.epicRefs.mapFor(projectId);
      return {
        folios: folios.map((f) => ({
          id: f.id,
          shortId: f.shortId,
          title: f.title,
          summary: f.summary || undefined,
          updatedAt: f.updatedAt,
          epic: f.epicId != null ? epicRefs.get(f.epicId) : undefined,
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
            epic: folioEpicRefSchema.optional(),
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
      const epicRefs = await this.epicRefs.mapFor(projectId);
      return {
        results: folios.map((f) => ({
          id: f.id,
          shortId: f.shortId,
          title: f.title,
          snippet: buildSnippet(f.content, params.query),
          updatedAt: f.updatedAt,
          epic: f.epicId != null ? epicRefs.get(f.epicId) : undefined,
        })),
      };
    },
  });

  folio_get = $tool({
    description:
      "Get the full content of a folio (markdown) plus its links: `outbound` is what this folio references with the typed grammar (`[[#F12]]` a folio, `[[#Q12]]` a quest, `[[#E3]]` an epic, `[[#P120]]` a feedback item, `[[#R12]]` a release; the number is the per-project id, and nothing else between `[[` and `]]` is a reference), `inbound` is the folios, quests and epics that reference this one. Use `inbound` as a backlink panel: it surfaces context that may be related. Accepts either the global UUID `id` or the per-project `shortId` (with `project` / `project_name`).",
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
        epic: await this.epicRefs.refFor(folio.projectId, folio.epicId),
        links,
      };
    },
  });

  folio_create = $tool({
    description:
      "Create a new folio in a project — a markdown note that becomes part of the project's memory for AI agents. Provide `project` (id) or `project_name`. `content` is markdown. Pass `epic_number` to file the folio under an epic (it then shows on the epic's Folios tab and in `epic_get`), the same way quest_create does. **Always set `summary`** — a 1-2 sentence (~200 chars) description of what the folio is for. It's the field other agents (and future calls of yours) read in `project_context` to decide whether to fetch the body. Without a summary, the index falls back to the title and orientation suffers.",
    title: "Create folio",
    annotations: { readOnlyHint: false, destructiveHint: false },
    schema: {
      params: z.object({
        project: z.integer().optional(),
        project_name: z.string().optional(),
        title: z.string().min(1).max(200),
        content: z
          .string()
          .describe(`The folio body, in Markdown. ${DIAGRAM_CAPABILITY}`)
          .optional(),
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
        epic_number: z
          .integer()
          .describe(
            "Per-project number of the epic to file this folio under (see epic_list). A design or outcome folio of an epic belongs here; left unattached it never shows on the epic.",
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
      // Resolved before the create so an unknown epic number fails with
      // nothing written.
      const epicId =
        params.epic_number != null
          ? await this.resolveEpicId(projectId, params.epic_number)
          : undefined;
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

      // File the folio under its epic. `FolioController.create` has no
      // `epicId` field of its own: `EpicController` owns that mutation, so
      // this is a second call, exactly as quest_create.
      //
      // A second call can fail on its own. Clean up rather than leave an
      // orphaned, unlinked folio behind: an agent that sees the error and
      // retries would otherwise create a duplicate every time. The
      // original error (not any delete failure) is what the caller sees.
      if (epicId != null) {
        try {
          await this.epicController.attachFolio({
            params: { id: epicId },
            body: { folioId: folio.id },
          });
        } catch (error) {
          await this.folioController.delete({ params: { id: folio.id } });
          throw error;
        }
      }

      return {
        id: folio.id,
        shortId: folio.shortId,
        title: folio.title,
        summary: folio.summary || undefined,
        content: folio.content,
        createdAt: folio.createdAt,
        updatedAt: folio.updatedAt,
        epic: await this.epicRefs.refFor(projectId, epicId),
        ...this.diagrams.warn(folio.content),
      };
    },
  });

  folio_update = $tool({
    description:
      "Update a folio. Any omitted field stays unchanged. `epic_number` files the folio under an epic, and 0 detaches it from its current one. Updating `content` is a good moment to also refresh `summary` so the orientation index in `project_context` stays accurate.",
    title: "Update folio",
    annotations: { readOnlyHint: false, idempotentHint: true },
    schema: {
      params: folioRefParamsSchema.extend({
        title: z.string().min(1).max(200).optional(),
        content: z
          .string()
          .describe(`The folio body, in Markdown. ${DIAGRAM_CAPABILITY}`)
          .optional(),
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
        epic_number: z
          .integer()
          .describe(
            "Move the folio under the epic with this per-project number (see epic_list). Pass 0 to detach it from its current epic. Omit to leave the epic untouched.",
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

      // Translate `epic_number`: 0 = detach from the folio's current epic
      // (a no-op if it has none), integer = resolve within the folio's own
      // project and attach. Applied BEFORE the field update, not after:
      // `attachFolio` / `detachFolio` are separate calls that can fail on
      // their own, so doing this first means such a failure throws before
      // any other field is written, and there is no window where the title
      // lands and the epic link silently does not.
      if (params.epic_number != null) {
        const current = await this.folioController.get({ params: { id } });
        if (params.epic_number === 0) {
          if (current.epicId != null) {
            await this.epicController.detachFolio({
              params: { id: current.epicId, folioId: id },
            });
          }
        } else {
          const epicId = await this.resolveEpicId(
            current.projectId,
            params.epic_number,
          );
          await this.epicController.attachFolio({
            params: { id: epicId },
            body: { folioId: id },
          });
        }
      }

      // An epic move alone is not an edit: skip the update (and the
      // revision it would record) when no other field was passed.
      const hasFieldUpdate =
        params.title !== undefined ||
        params.content !== undefined ||
        params.summary !== undefined ||
        directoryId !== undefined ||
        params.pinned !== undefined;
      const folio = hasFieldUpdate
        ? await this.folioController.update({
            params: { id },
            body: {
              title: params.title,
              content: params.content,
              summary: params.summary,
              directoryId,
              pinned: params.pinned,
            },
          })
        : await this.folioController.get({ params: { id } });
      return {
        id: folio.id,
        shortId: folio.shortId,
        title: folio.title,
        summary: folio.summary || undefined,
        content: folio.content,
        createdAt: folio.createdAt,
        updatedAt: folio.updatedAt,
        epic: await this.epicRefs.refFor(folio.projectId, folio.epicId),
        // `params.content`, not `folio.content`: a call that only renamed the
        // folio must not be warned about a diagram it did not write.
        ...this.diagrams.warn(params.content),
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

  folio_delete = $tool({
    description: "Delete a folio. This cannot be undone.",
    title: "Delete folio",
    annotations: {
      destructiveHint: true,
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
      "List the contents of a directory (folios + child directories) in one call. Pass `directory_shortId` to drill in, or omit for the project root. Returns the directory metadata, the breadcrumb (root → … → parent), and `entries` tagged by `kind`. This is the Drive-like browse endpoint for AI agents. Attachments are not listed here: a blob belongs to one folio rather than to a folder, so ask `folio_attachment_list` for a folio's.",
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
            // No `"blob"`: an attachment belongs to a folio, not to a
            // folder, so it is never a child of a directory. Ask
            // `folio_attachment_list` for a folio's attachments.
            kind: z.enum(["directory", "folio"]),
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
      "Delete a directory. Refuses if not empty unless `cascade: true` — cascade recursively wipes the subtree (folios + attachments + sub-directories) via the DB cascade.",
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
  // folio_attachment_* tools: a folio's attachments
  //
  // Markdown reaches an attachment as `![name](assets/<name>)` for an image
  // or `[name](assets/<name>)` for anything else; the old `blob:` embed and
  // wiki-link forms are gone (epic #32).
  //
  // Uploads were out of scope here until `quest_attachment_add` proved the
  // channel: base64 through a JSON-RPC frame is a bad way to move bytes,
  // which is an argument for a size ceiling and not for making an agent
  // paste a diagram into the body as text. Same 2 MB cap, same validation,
  // shared with the quest surface through `AttachmentUploadService`.
  // ---------------------------------------------------------------------------

  folio_attachment_add = $tool({
    description:
      "Attach a file to a folio: a diagram, a CSV of measurements, a screenshot, an HTML mockup. Embed it in the folio body afterwards with the `path` this returns — `![name](assets/<name>)` for an image, `[name](assets/<name>)` for anything else — since a file nothing references is a file nobody finds. " +
      "Any file type, capped at 2 MB decoded, so put anything bigger where it belongs and link to it. A name already taken on the folio is auto-suffixed (`chart (1).png`), so write the returned `name` / `path` rather than the one you sent.",
    title: "Attach a file to a folio",
    annotations: { readOnlyHint: false, destructiveHint: false },
    schema: {
      params: z.object({
        project: z.integer().optional(),
        project_name: z.string().optional(),
        folio_shortId: z.integer(),
        name: z
          .string()
          .min(1)
          .max(200)
          .describe(
            "File name, extension included. It is what the `assets/` reference is addressed by, so it is the name a reader sees.",
          ),
        mimeType: z
          .string()
          .describe('Media type, e.g. "image/png" or "text/csv".'),
        data: z
          .string()
          .describe("The file's bytes, base64, with no data-URL prefix."),
      }),
      result: z.object({
        shortId: z
          .integer()
          .describe(
            "Per-project attachment id — what `folio_attachment_rename` / `_delete` address it by.",
          ),
        name: z.string().describe("The name it was stored under."),
        path: z
          .string()
          .describe("The markdown reference: `assets/<name>`, URL-encoded."),
        mimeType: z.string(),
        size: z.number(),
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

      // A protected folio's `content` is a client-side encryption envelope
      // the server cannot read, so it can neither hold the reference this
      // returns nor have it repointed on a later rename — which is why the
      // editor hides its upload handler there. MCP is not the way around
      // that.
      const folio = await this.folioController.get({ params: { id: folioId } });
      if (folio.protected) {
        throw new BadRequestError(
          `Folio #${params.folio_shortId} is protected: its content is encrypted client-side, so an attachment could never be referenced from it. Attach the file to an unprotected folio instead.`,
        );
      }

      // Validated before a single byte reaches the bucket, so a refusal
      // leaves nothing behind.
      const file = this.attachmentUpload.toFile(params, "folio");

      // Two calls, same as the editor: the bytes go to the bucket, then the
      // file is placed in this folio under a name unique to it.
      const uploaded = await this.attachmentController.uploadFolioAttachment({
        body: { file },
      });
      const attachment = await this.attachmentController.registerAttachment({
        params: { projectId },
        body: { fileId: uploaded.fileId, name: params.name, folioId },
      });

      return {
        shortId: attachment.shortId,
        // `register` renames on collision, so this is the stored name and
        // not the requested one.
        name: attachment.name,
        path: folioAssetPath(attachment.name),
        mimeType: file.type,
        size: file.size,
      };
    },
  });

  folio_attachment_list = $tool({
    description:
      "List the attachments of one folio. Each entry includes shortId, name, size, mimeType, and the optional sha256 + originalName.",
    title: "List attachments",
    annotations: { readOnlyHint: true, idempotentHint: true },
    schema: {
      params: z.object({
        project: z.integer().optional(),
        project_name: z.string().optional(),
        folio_shortId: z.integer(),
      }),
      result: z.object({
        attachments: z.array(
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
      const attachments = await this.attachmentController.listAttachments({
        params: { folioId },
      });
      return {
        attachments: attachments.map((b) => ({
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

  folio_attachment_rename = $tool({
    description: "Rename an attachment of a folio (auto-suffix on collision).",
    title: "Rename attachment",
    annotations: { idempotentHint: true, destructiveHint: false },
    schema: {
      params: z.object({
        project: z.integer().optional(),
        project_name: z.string().optional(),
        attachment_shortId: z.integer(),
        name: z.string().min(1).max(200),
      }),
      result: z.object({ shortId: z.integer(), name: z.string() }),
    },
    handler: async ({ params }) => {
      const projectId = await this.resolveProjectId(
        params.project,
        params.project_name,
      );
      const fileId = await this.resolveAttachmentFileId(
        projectId,
        params.attachment_shortId,
      );
      const updated = await this.attachmentController.renameAttachment({
        params: { id: fileId },
        body: { name: params.name },
      });
      return { shortId: updated.shortId, name: updated.name };
    },
  });

  folio_attachment_delete = $tool({
    description: "Delete an attachment of a folio and reclaim its storage.",
    title: "Delete attachment",
    annotations: { destructiveHint: true },
    schema: {
      params: z.object({
        project: z.integer().optional(),
        project_name: z.string().optional(),
        attachment_shortId: z.integer(),
      }),
      result: z.object({ ok: z.boolean() }),
    },
    handler: async ({ params }) => {
      const projectId = await this.resolveProjectId(
        params.project,
        params.project_name,
      );
      const fileId = await this.resolveAttachmentFileId(
        projectId,
        params.attachment_shortId,
      );
      await this.attachmentController.deleteAttachment({
        params: { id: fileId },
      });
      return { ok: true };
    },
  });
}
