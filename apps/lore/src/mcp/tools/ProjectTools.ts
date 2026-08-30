import { $inject, Alepha, z } from "alepha";
import { $tool } from "alepha/mcp";
import { currentUserAtom } from "alepha/security";
import { BadRequestError, NotFoundError } from "alepha/server";

import { pinnedContentAtom } from "../../api/atoms/pinnedContentAtom.ts";
import { EpicController } from "../../api/controllers/EpicController.ts";
import { FolioController } from "../../api/controllers/FolioController.ts";
import { ProjectController } from "../../api/controllers/ProjectController.ts";
import { ReleaseController } from "../../api/controllers/ReleaseController.ts";
import { AreaService } from "../../api/services/AreaService.ts";
import { PinnedFolioFolder } from "../../api/services/PinnedFolioFolder.ts";
import {
  projectActivityParamsSchema,
  projectActivityResultSchema,
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
 * Cap on each area's `description` as it crosses the MCP boundary.
 *
 * Deliberately the OPPOSITE shape from `FOLIO_INDEX_CAP` above: that one
 * bounds the NUMBER of folios and flags when entries are dropped, because
 * an agent that needs more can always follow up with `folio_get`. The
 * area LIST is never capped — an agent that cannot see an existing area
 * name is exactly the agent that invents a new one, which is the
 * regrowth this task exists to stop, so every area must stay visible in
 * full. Only each entry's `description` is bounded here, to keep the
 * payload predictable while the list itself stays whole.
 * `areas.description` carries no length limit at the entity level
 * (`meta({ size: "rich" })`), so this is the only thing standing between
 * a verbose write on the settings page and an unbounded MCP payload.
 */
const AREA_DESCRIPTION_MAX_CHARS = 160;

/**
 * MCP tools for project operations.
 */
export class ProjectTools {
  protected readonly projectController = $inject(ProjectController);
  protected readonly folioController = $inject(FolioController);
  protected readonly epicController = $inject(EpicController);
  protected readonly releaseController = $inject(ReleaseController);
  protected readonly areaService = $inject(AreaService);
  protected readonly pinnedFolder = $inject(PinnedFolioFolder);
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
   * `{ name, description }` mapping shared by `project_info` and
   * `project_context` so the two call sites cannot drift. Truncates
   * `description` to `AREA_DESCRIPTION_MAX_CHARS`, appending an ellipsis
   * when clipped — see that constant's own comment for why the area
   * LIST itself is never capped the same way.
   */
  protected toAreaSummaries(
    areas: Array<{ name: string; description: string }>,
  ): Array<{ name: string; description: string }> {
    return areas.map((area) => ({
      name: area.name,
      description:
        area.description.length > AREA_DESCRIPTION_MAX_CHARS
          ? `${area.description.slice(0, AREA_DESCRIPTION_MAX_CHARS)}…`
          : area.description,
    }));
  }

  /**
   * List all projects the user has access to.
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

      // `createdBy !== undefined` was true for every row, so a plain member
      // was told it could run owner-only mutations and only found out when
      // one failed. `getMyProjects` returns project resources, not the
      // membership row, so ownership is read the way the web app reads it:
      // the creator is the owner.
      const me = this.alepha.store.get(currentUserAtom);

      return {
        projects: projects.map((p) => ({
          id: p.id,
          title: p.title,
          public: p.public ?? false,
          isOwner: me !== undefined && p.createdBy === me.id,
        })),
      };
    },
  });

  /**
   * Get project information.
   */
  project_info = $tool({
    description:
      "Get lightweight metadata about a project — areas (each with a `name` and a `description` of what it covers), currently-active quests for the calling user, membership info. Call this before `quest_create` and REUSE an existing area's exact name rather than inventing a new one; read each area's `description` to pick the right one. For a richer orientation that also includes the folio index, prefer `project_context`.",
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

      const areas = await this.areaService.listWithStats(projectId);

      return {
        id: result.id,
        title: result.title,
        public: result.public ?? false,
        areas: this.toAreaSummaries(areas),
        createdAt: result.createdAt,
        activeQuests: result.quests.map((quest) => ({
          id: quest.id,
          shortId: quest.shortId,
          title: quest.title,
          area: quest.area,
          priority: quest.priority,
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
      "ORIENTATION TOOL — call FIRST on any project-scoped task. Returns project metadata, areas (each with a `name` and a `description` of what it covers — read these before filing a quest, and REUSE an existing area's exact name rather than registering a new one), the calling user's currently-active quests, the epic index (number, title, status, questCount; every epic, planned/active/done alike), the folio index (titles + summaries + updatedAt, NO content bodies), AND the full content of any pinned folios (the per-project CLAUDE.md / AGENTS.md — read these first, they're the project rules). A quest belonging to a planned epic (see `epics`) still appears in `quest_list` (MCP is not gated), so check the epic index before treating a cluster of related-looking quests as unrelated noise. Folios are this project's shared memory for AI agents — read the index here, then call `folio_get` only on the ones that look relevant. ~2K tokens of complete situational awareness in one round-trip; the folio index is capped at 30 entries (sorted by pinned DESC, updatedAt DESC) — when `folios.capped` is true, use `folio_list` with a higher `limit` to fetch the rest. Pinned-folio total content is capped at ~8K chars; when `pinnedFoliosTruncated` is true some pinned bodies were dropped, and a pinned entry carrying `truncatedAt` was cut at that character — `folio_get` either kind by id to read it whole. When `preferredLanguage` is set (ISO 639-1 — e.g. `fr`, `ja`), generated content (quest titles, descriptions, folio bodies) MUST be written in that language unless the user explicitly asks for another.",
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

      // `areas` table is the source of truth for the list (`projects.areas`
      // is a deprecated rollback net nothing else reads — see
      // `QuestService.createQuest`). Only `name` + `description` cross the
      // MCP boundary: this call is paid for on every `project_context`
      // round-trip, and the stats (`questCount`, dates) are a settings-page
      // concern, not an orientation one.
      const areaStats = await this.areaService.listWithStats(projectId);

      // The epic index. Never gated (same as an epic's own view of
      // itself) — orientation is exactly what failed for the work that
      // motivated this: thirteen quests parked under one epic read as
      // noise with no signal they were one subject.
      const epics = await this.epicController.getEpics({
        params: { projectId },
      });

      // The open releases, so an agent opens a session already knowing what
      // `0.28.0` is meant to contain. Published ones are dropped: this index
      // is for planning into, and a shipped release is not.
      const openReleases = (
        await this.releaseController.getReleases({ params: { projectId } })
      )
        .filter((release) => !release.releasedAt)
        .sort((a, b) => a.number - b.number);

      // Fetch one over the cap to detect truncation without a separate count
      // query — cheap on D1 (single LIKE-free indexed range scan).
      const folios = await this.folioController.list({
        query: {
          projectId,
          limit: FOLIO_INDEX_CAP + 1,
        },
      });
      const capped = folios.length > FOLIO_INDEX_CAP;
      // The epic index above already holds every epic's number; a folio
      // only needs to point into it.
      const epicNumberById = new Map(
        epics.map((epic) => [epic.id, epic.number]),
      );
      const items = (capped ? folios.slice(0, FOLIO_INDEX_CAP) : folios).map(
        (folio) => ({
          shortId: folio.shortId,
          title: folio.title,
          updatedAt: folio.updatedAt,
          // Omit when empty so agents seeing the field always trust it.
          // The schema field is optional; consumers fall back to title.
          summary: folio.summary?.trim() ? folio.summary : undefined,
          epicNumber:
            folio.epicId != null ? epicNumberById.get(folio.epicId) : undefined,
        }),
      );

      // Pinned-folio content surface (the per-project CLAUDE.md). Drop
      // protected folios — their content is ciphertext and useless to
      // the agent. Cap logic lives in `foldPinnedFolios` so it can be
      // unit-tested without spinning the MCP transport.
      const cap = this.alepha.store.get(pinnedContentAtom).maxChars;
      const { pinnedFolios, pinnedFoliosTruncated } = this.pinnedFolder.fold(
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
        areas: this.toAreaSummaries(areaStats),
        createdAt: result.createdAt,
        activeQuests: result.quests.map((quest) => ({
          id: quest.id,
          shortId: quest.shortId,
          title: quest.title,
          area: quest.area,
          priority: quest.priority,
        })),
        epics: epics.map((epic) => ({
          number: epic.number,
          title: epic.title,
          status: epic.status,
          questCount: epic.questCount,
        })),
        openReleases: openReleases.map((release) => ({
          tag: release.tag,
          title: release.title,
          targetDate: release.targetDate,
          completed: release.progress.completed,
          total: release.progress.total,
        })),
        folios: {
          shown: items.length,
          capped,
          items,
        },
        pinnedFolios,
        pinnedFoliosTruncated,
        isOwner: result.member?.owner ?? false,
        preferredLanguage: result.preferredLanguage,
      };
    },
  });

  /**
   * What moved in a project since a timestamp.
   */
  project_activity = $tool({
    description:
      "Everything that happened in a project since a timestamp, in one call: quests filed, accepted, unassigned, completed, shelved or edited, comments posted, feedback reported, folios written. Read-only. " +
      "Call it at the START of a session with the stamp your last session ended on, and again before writing back to a quest you have not re-read: this is what stops you answering a conversation you never saw. " +
      "Events come back oldest first with an `until` cursor to pass as the next call's `since`; events sharing that exact millisecond are not repeated, so treat the cursor as the boundary it is. " +
      "Your own events are excluded unless you pass `includeOwn`. For the per-quest version of the same signal while scanning a list, `quest_list` rows carry `lastCommentAt`.",
    title: "Project activity since",
    annotations: { readOnlyHint: true, idempotentHint: true },
    schema: {
      params: projectActivityParamsSchema,
      result: projectActivityResultSchema,
    },
    handler: async ({ params }) => {
      const projectId = await this.resolveProjectId(
        params.project,
        params.project_name,
      );

      return await this.projectController.getProjectActivity({
        params: { id: projectId },
        query: {
          since: params.since,
          limit: params.limit,
          includeOwn: params.includeOwn,
        },
      });
    },
  });
}
