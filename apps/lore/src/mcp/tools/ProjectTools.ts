import { $inject, Alepha, z } from "alepha";
import { $tool } from "alepha/mcp";
import { currentUserAtom } from "alepha/security";
import { BadRequestError, ForbiddenError, NotFoundError } from "alepha/server";

import { pinnedContentAtom } from "../../api/atoms/pinnedContentAtom.ts";
import { EpicController } from "../../api/controllers/EpicController.ts";
import { FolioController } from "../../api/controllers/FolioController.ts";
import { ProjectController } from "../../api/controllers/ProjectController.ts";
import { ReleaseController } from "../../api/controllers/ReleaseController.ts";
import type { CapabilityKey } from "../../api/schemas/capabilityKeySchema.ts";
import { AreaService } from "../../api/services/AreaService.ts";
import { PinnedFolioFolder } from "../../api/services/PinnedFolioFolder.ts";
import { ProjectSecurityService } from "../../api/services/ProjectSecurityService.ts";
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
  protected readonly projectSecurity = $inject(ProjectSecurityService);
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
    if (project) {
      // A numeric id needs the membership check that authorizes the call, and
      // nothing else. Reading every project the caller belongs to, mapping
      // each one through `projectMapper.toResource`, and then handing back the
      // id we were given was three of `feedback_list`'s five reads - spent
      // before the tool did any of its own work. An MCP call is one operation
      // per HTTP request, so unlike `POST /api/_batch` there is no sibling to
      // amortize that against: it was paid in full on every tool call.
      //
      // `assertMember` is the same gate `$ownsProject` applies on the HTTP
      // side, and it reads the project row through the ORM's keyed cache.
      //
      // ⚠️ The refusal is deliberately re-thrown as `NotFoundError`.
      // `assertMember` answers `ForbiddenError`, which confirms the project
      // EXISTS; this surface has never distinguished "no such project" from
      // "not yours", and `EpicTools.spec.ts` pins that on the most
      // destructive tool here. Same reasoning as the public roadmap's
      // 404-never-403. Keeping the read cheap must not widen what a
      // non-member can learn, so both refusals collapse into the message
      // this resolver has always returned. Anything else is a real failure
      // and propagates untouched.
      const me = this.alepha.store.get(currentUserAtom);
      if (!me) {
        throw new NotFoundError(`Project with ID ${project} not found`);
      }
      try {
        await this.projectSecurity.assertMember(project, me);
      } catch (error) {
        if (error instanceof ForbiddenError || error instanceof NotFoundError) {
          throw new NotFoundError(`Project with ID ${project} not found`);
        }
        throw error;
      }
      return project;
    }

    if (projectName) {
      // A name has to be compared against the titles, so this path still
      // reads the list. It is the rarer of the two: an agent that has called
      // any tool once is holding ids.
      const projects = await this.projectController.getMyProjects();
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
   * One-shot orientation tool. Returns the project's metadata and capability
   * set, then only the sections those capabilities own. Designed as the FIRST
   * call any agent makes when picking up a project-scoped task - folios
   * act as the project's memory for Claude (see apps/lore/CLAUDE.md).
   *
   * ⚠️ **A disabled capability's sections are ABSENT, never empty.** An agent
   * reading `epics: []` concludes the project tracks epics and has none yet,
   * then files one; reading no `epics` key at all, it does not. That is why
   * every capability-owned key on `projectContextResultSchema` is optional.
   *
   * Measured on a Knowledge-only project holding five folios: 947 chars
   * (~237 tokens) here against 1216 (~304) with all four capabilities on.
   * The saving is small and the reason to do it is not the saving.
   */
  project_context = $tool({
    description:
      "ORIENTATION TOOL — call FIRST on any project-scoped task. Returns project metadata, the capability set (what this project DOES: `work`, `knowledge`, `apps`, `support`, each with its options), and then only the sections those capabilities own — a section a project has turned off is ABSENT, never an empty array, because `epics: []` would read as 'no epics yet' rather than 'this project does not track epics'. Work brings areas (each with a `name` and a `description` of what it covers — read these before filing a quest, and REUSE an existing area's exact name rather than registering a new one), the calling user's currently-active quests, the epic index (number, title, status, questCount; every epic, planned/active/done alike), the folio index (titles + summaries + updatedAt, NO content bodies), AND the full content of any pinned folios (the per-project CLAUDE.md / AGENTS.md — read these first, they're the project rules). An epic's status is the permission on its quests: filed into it only while `planned`, worked (accepted, completed) only while `active`, and `done` is terminal, with epic_set_status moving it forward one way. A planned epic's quests are hidden from `quest_list`'s default view, like the UI's backlog; pass `epic:` or `includePlanned: true` to read them, and check the epic index (each entry carries `completed` beside `questCount`, so a planned epic with all its quests done reads as what it is) before treating a cluster of related-looking quests as unrelated noise. Knowledge brings the folio index and the pinned folios; folios are this project's shared memory for AI agents — read the index here, then call `folio_get` only on the ones that look relevant. A write into a capability the project does not have is refused with a 400 naming it and how to turn it on. Complete situational awareness in one round-trip, and its size follows the capability set rather than a fixed budget: a Knowledge-only project with five folios measures ~240 tokens, and ~2K is the ceiling with everything on, almost all of it the pinned-folio bodies. The folio index is capped at 30 entries (sorted by pinned DESC, updatedAt DESC) — when `folios.capped` is true, use `folio_list` with a higher `limit` to fetch the rest. Pinned-folio total content is capped at ~8K chars; when `pinnedFoliosTruncated` is true some pinned bodies were dropped, and a pinned entry carrying `truncatedAt` was cut at that character — `folio_get` either kind by id to read it whole. When `preferredLanguage` is set (ISO 639-1 — e.g. `fr`, `ja`), generated content (quest titles, descriptions, folio bodies) MUST be written in that language unless the user explicitly asks for another.",
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

      // ⚠️ **What this project has decides what the rest of this call does.**
      // A section a disabled capability owns is OMITTED, never emptied:
      // `epics: []` on a project with no Work reads as "no epics yet", which
      // is a different and wrong answer. It also stops paying for reads whose
      // results the project has no use for - a Knowledge-only project ran
      // three of them for three empty arrays.
      const capabilities = result.capabilities;
      const has = (key: CapabilityKey) =>
        capabilities.some((it) => it.key === key);
      const hasWork = has("work");
      const hasKnowledge = has("knowledge");

      // `areas` table is the source of truth for the list (`projects.areas`
      // is a deprecated rollback net nothing else reads — see
      // `QuestService.createQuest`). Only `name` + `description` cross the
      // MCP boundary: this call is paid for on every `project_context`
      // round-trip, and the stats (`questCount`, dates) are a settings-page
      // concern, not an orientation one.
      //
      // Work's, because a quest carries an area and a blight forwards into
      // one.
      const areaStats = hasWork
        ? await this.areaService.listWithStats(projectId)
        : [];

      // The epic index. Never gated on an epic's STATUS (same as an epic's
      // own view of itself) — orientation is exactly what failed for the work
      // that motivated this: thirteen quests parked under one epic read as
      // noise with no signal they were one subject. It is Work's, though.
      const epics = hasWork
        ? await this.epicController.getEpics({ params: { projectId } })
        : [];

      // The open releases, so an agent opens a session already knowing what
      // `0.28.0` is meant to contain. Published ones are dropped: this index
      // is for planning into, and a shipped release is not.
      const openReleases = hasWork
        ? (await this.releaseController.getReleases({ params: { projectId } }))
            .filter((release) => !release.releasedAt)
            .sort((a, b) => a.number - b.number)
        : [];

      // Fetch one over the cap to detect truncation without a separate count
      // query — cheap on D1 (single LIKE-free indexed range scan).
      const folios = hasKnowledge
        ? await this.folioController.list({
            query: {
              projectId,
              limit: FOLIO_INDEX_CAP + 1,
            },
          })
        : [];
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
        capabilities: capabilities.map((it) => ({
          key: it.key,
          options: it.options,
        })),
        createdAt: result.createdAt,
        ...(hasWork
          ? {
              areas: this.toAreaSummaries(areaStats),
              activeQuests: result.quests.map((quest) => ({
                id: quest.id,
                shortId: quest.shortId,
                title: quest.title,
                area: quest.area,
                priority: quest.priority,
              })),
            }
          : {}),
        ...(hasWork
          ? {
              epics: epics.map((epic) => ({
                number: epic.number,
                title: epic.title,
                status: epic.status,
                questCount: epic.questCount,
                // Beside the count, so "planned, 9 specified" and "planned, 9
                // shipped" are distinguishable at orientation. Epic #27 was
                // worked to 9 of 9 while planned, and this is the field that
                // would have shown it.
                completed: epic.progress.completed,
              })),
              openReleases: openReleases.map((release) => ({
                tag: release.tag,
                title: release.title,
                targetDate: release.targetDate,
                completed: release.progress.completed,
                total: release.progress.total,
              })),
            }
          : {}),
        ...(hasKnowledge
          ? {
              folios: {
                shown: items.length,
                capped,
                items,
              },
              pinnedFolios,
              pinnedFoliosTruncated,
            }
          : {}),
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
      "Everything that happened in a project since a timestamp, in one call: quests filed, accepted, assigned, completed, shelved, edited or deleted, comments posted, epics and releases moved, folios written, feedback triaged. Read-only. " +
      "Call it at the START of a session with the stamp your last session ended on, and again before writing back to a quest you have not re-read: this is what stops you answering a conversation you never saw. " +
      "Events come back oldest first with an `until` cursor to pass as the next call's `since`; events sharing that exact millisecond are not repeated, so treat the cursor as the boundary it is. " +
      "Your own events are excluded unless you pass `includeOwn`. For the per-quest version of the same signal while scanning a list, `quest_list` rows carry `lastCommentAt`. " +
      "⚠️ This reads a recorded event log, so it reports only what happened AFTER the log existed. Anything older lives on the entities themselves - a quest's own history, a folio's revisions - and is reached with `quest_get` / `folio_history`.",
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
      const me = this.alepha.store.get(currentUserAtom);

      const size = params.limit ?? 100;
      const page = await this.projectController.getProjectActivity({
        params: { id: projectId },
        query: {
          // Exclusive, which is what makes `since: previous.until` safe.
          after: params.since,
          size,
          // Oldest first, which is what a cursor pages forward through. The
          // page reads the same endpoint the other way round.
          sort: "createdAt",
        },
      });

      // `after` has already excluded the boundary at the column's precision.
      // This second pass excludes it at the CALLER's precision, which is the
      // millisecond ISO stamp handed out as `until` - the two differ wherever
      // the column stores more than a millisecond. Without it the same event
      // arrives on every call, forever.
      //
      // The cost is the standard one for a timestamp cursor: two events
      // sharing an exposed millisecond with `until` are not reported. Stated
      // in the tool description rather than hidden.
      const rows = page.content.filter((row) => row.createdAt > params.since);
      // Filtered here rather than in the query: `auditQuerySchema` has no
      // "every user but this one" filter, and adding one to the framework to
      // serve a default nobody asked for would be the wrong place to spend it.
      // The cursor below is computed from what was READ, not from what was
      // kept, so an excluded event is never handed out again.
      const kept =
        params.includeOwn || !me?.id
          ? rows
          : rows.filter((row) => row.userId !== me.id);

      return {
        events: kept.map((row) => ({
          createdAt: row.createdAt,
          type: row.type,
          action: row.action,
          userId: row.userId,
          actor: row.actor,
          resourceId: row.resourceId,
          description: row.description,
          // ⚠️ Load-bearing since #1872, not decoration. Coalescing means one
          // event here can stand for ten writes, so an agent reading this
          // feed would silently lose that without the count - and `updatedAt`
          // is what tells it the burst ran until 14:52 rather than ending at
          // `createdAt`.
          eventCount: row.eventCount ?? 1,
          updatedAt: row.updatedAt,
          summary: this.activitySummary(row),
        })),
        truncated: rows.length >= size,
        since: params.since,
        // The last event READ. With nothing to report, the window's own start
        // is the honest cursor.
        until: rows.at(-1)?.createdAt ?? params.since,
      };
    },
  });

  /**
   * One readable phrase for an event, so an agent does not have to decode
   * `type` and `action` against each other to know what happened.
   *
   * Deliberately generic rather than a per-pair lookup table: there are eight
   * types and up to fourteen actions each, and a table of a hundred phrases
   * goes stale the first time somebody adds an action without noticing it.
   * `"completed quest #208"` from the two columns is worth more than a
   * hand-written phrase that stops matching.
   */
  protected activitySummary(row: {
    type: string;
    action: string;
    resourceId?: string;
    description?: string;
    eventCount?: number;
  }): string {
    // `#` reads as an identifier for the numbered kinds and as noise for a
    // release, whose id is already a tag like `0.28.0`.
    const numbered = row.type === "quest" || row.type === "epic";
    const ref = row.resourceId
      ? ` ${numbered ? "#" : ""}${row.resourceId}`
      : "";
    const title = row.description ? ` (${row.description})` : "";
    // The count belongs in the phrase, not only in the field: this string is
    // what an agent skims, and "update quest #12" reading the same for one
    // edit and for twelve is the information coalescing would otherwise cost.
    const times = (row.eventCount ?? 1) > 1 ? ` x${row.eventCount}` : "";
    return `${row.action}${times} ${row.type}${ref}${title}`;
  }
}
