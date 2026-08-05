import { $inject, Alepha, z } from "alepha";
import { $tool } from "alepha/mcp";
import { BadRequestError, NotFoundError } from "alepha/server";
import { pinnedContentAtom } from "../../api/atoms/pinnedContentAtom.ts";
import { FolioController } from "../../api/controllers/FolioController.ts";
import { ProjectController } from "../../api/controllers/ProjectController.ts";
import { foldPinnedFolios } from "../../api/services/PinnedFolioFolder.ts";
import {
  projectContextParamsSchema,
  projectContextResultSchema,
  projectInfoParamsSchema,
  projectInfoResultSchema,
  projectListResultSchema,
} from "../schemas/index.ts";

/**
 * Folio index cap returned by `project_context`. Sized so a project with
 * 30 folios fits well under the ~2K token orientation budget; beyond this
 * the index would crowd out the quest signal. Agents follow the `capped`
 * flag and drill via `folio_list` when they need the long tail.
 */
const FOLIO_INDEX_CAP = 30;

/**
 * MCP tools for project operations.
 */
export class ProjectTools {
  protected readonly projectController = $inject(ProjectController);
  protected readonly folioController = $inject(FolioController);
  protected readonly alepha = $inject(Alepha);

  /**
   * Resolve project ID from params (by ID or name).
   *
   * `public` so sibling tool classes can accept the same `project` /
   * `project_name` pair without each re-implementing the lookup — an agent
   * that can name a project for one tool should be able to name it for all
   * of them.
   */
  public async resolveProjectId(
    project?: number,
    projectName?: string,
  ): Promise<number> {
    const projects = await this.projectController.getMyProjects();

    if (project) {
      const found = projects.find((p) => p.id === project);
      if (!found) {
        throw new NotFoundError(`Project with ID ${project} not found`);
      }
      return found.id;
    }

    if (projectName) {
      const found = projects.find(
        (p) => p.title.toLowerCase() === projectName.toLowerCase(),
      );
      if (!found) {
        throw new NotFoundError(`Project "${projectName}" not found`);
      }
      return found.id;
    }

    throw new BadRequestError(
      "Project is required. Specify project ID or project_name.",
    );
  }

  /**
   * List all projects (projects) the user has access to.
   */
  project_list = $tool({
    description:
      "List all projects the user has access to (owned + member-of). Use this to find the project id (required by most other tools) and check the title for project_name lookups. Each entry includes id, title, public (boolean), isOwner (boolean).",
    title: "List projects",
    annotations: {
      readOnlyHint: true,
      idempotentHint: true,
    },
    schema: {
      params: z.object({}),
      result: projectListResultSchema,
    },
    handler: async () => {
      const projects = await this.projectController.getMyProjects();

      return {
        projects: projects.map((p) => ({
          id: p.id,
          title: p.title,
          public: p.public ?? false,
          isOwner: p.createdBy !== undefined, // Owner info from project
        })),
      };
    },
  });

  /**
   * Get project information.
   */
  project_info = $tool({
    description:
      "Get lightweight metadata about a project — zones, currently-active quests for the calling user, membership info. Call this before `quest_create` to see existing zones and reuse them with correct casing. For a richer orientation that also includes the folio index, prefer `project_context`.",
    title: "Project info",
    annotations: {
      readOnlyHint: true,
      idempotentHint: true,
    },
    schema: {
      params: projectInfoParamsSchema,
      result: projectInfoResultSchema,
    },
    handler: async ({ params }) => {
      const projectId = await this.resolveProjectId(
        params.project,
        params.project_name,
      );

      const result = await this.projectController.getProjectById({
        params: { id: projectId },
      });

      return {
        id: result.id,
        title: result.title,
        public: result.public ?? false,
        zones: result.zones,
        createdAt: result.createdAt,
        activeQuests: result.quests.map((quest) => ({
          id: quest.id,
          shortId: quest.shortId,
          title: quest.title,
          zone: quest.zone,
          priority: quest.priority,
          difficulty: quest.difficulty,
        })),
        isOwner: result.member?.owner ?? false,
      };
    },
  });

  /**
   * One-shot orientation tool. Returns project metadata + active quests +
   * the folio index in a single ~2K-token payload. Designed as the FIRST
   * call any agent makes when picking up a project-scoped task — folios
   * act as the project's memory for Claude (see apps/lore/CLAUDE.md).
   */
  project_context = $tool({
    description:
      "ORIENTATION TOOL — call FIRST on any project-scoped task. Returns project metadata, zones, the calling user's currently-active quests, the folio index (titles + tags + updatedAt, NO content bodies), AND the full content of any pinned folios (the per-project CLAUDE.md / AGENTS.md — read these first, they're the project rules). Folios are this project's shared memory for AI agents — read the index here, then call `folio_get` only on the ones that look relevant. ~2K tokens of complete situational awareness in one round-trip; the folio index is capped at 30 entries (sorted by pinned DESC, updatedAt DESC) — when `folios.capped` is true, use `folio_list` with a `tag` filter to fetch the rest. Pinned-folio total content is capped at ~8K chars; when `pinnedFoliosTruncated` is true some pinned bodies were dropped — `folio_get` them by id. When `preferredLanguage` is set (ISO 639-1 — e.g. `fr`, `ja`), generated content (quest titles, descriptions, folio bodies) MUST be written in that language unless the user explicitly asks for another.",
    title: "Project context (orientation)",
    annotations: {
      readOnlyHint: true,
      idempotentHint: true,
    },
    schema: {
      params: projectContextParamsSchema,
      result: projectContextResultSchema,
    },
    handler: async ({ params }) => {
      const projectId = await this.resolveProjectId(
        params.project,
        params.project_name,
      );

      // Reuse `getProjectById` so quest scoping (acceptedBy === user) and
      // membership checks stay in one place. One round-trip for the project
      // + membership + active quests.
      const result = await this.projectController.getProjectById({
        params: { id: projectId },
      });

      // Fetch one over the cap to detect truncation without a separate count
      // query — cheap on D1 (single LIKE-free indexed range scan).
      const folios = await this.folioController.list({
        query: {
          projectId,
          limit: FOLIO_INDEX_CAP + 1,
        },
      });
      const capped = folios.length > FOLIO_INDEX_CAP;
      const items = (capped ? folios.slice(0, FOLIO_INDEX_CAP) : folios).map(
        (folio) => ({
          shortId: folio.shortId,
          title: folio.title,
          tags: folio.tags ?? [],
          updatedAt: folio.updatedAt,
          // Omit when empty so agents seeing the field always trust it.
          // The schema field is optional; consumers fall back to title.
          summary: folio.summary?.trim() ? folio.summary : undefined,
        }),
      );

      // Pinned-folio content surface (the per-project CLAUDE.md). Drop
      // protected folios — their content is ciphertext and useless to
      // the agent. Cap logic lives in `foldPinnedFolios` so it can be
      // unit-tested without spinning the MCP transport.
      const cap = this.alepha.store.get(pinnedContentAtom).maxChars;
      const { pinnedFolios, pinnedFoliosTruncated } = foldPinnedFolios(
        folios
          .filter((f) => f.pinned && !f.protected)
          // controller already sorts (pinned DESC, updatedAt DESC) so
          // this slice is already newest-first.
          .map((f) => ({
            id: f.id,
            shortId: f.shortId,
            title: f.title,
            content: f.content,
          })),
        cap,
      );

      return {
        id: result.id,
        title: result.title,
        public: result.public ?? false,
        zones: result.zones,
        createdAt: result.createdAt,
        activeQuests: result.quests.map((quest) => ({
          id: quest.id,
          shortId: quest.shortId,
          title: quest.title,
          zone: quest.zone,
          priority: quest.priority,
          difficulty: quest.difficulty,
        })),
        folios: {
          shown: items.length,
          capped,
          items,
        },
        pinnedFolios,
        pinnedFoliosTruncated,
        isOwner: result.member?.owner ?? false,
      };
    },
  });
}
