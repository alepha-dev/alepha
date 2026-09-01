import { $inject } from "alepha";
import { $tool } from "alepha/mcp";
import { BadRequestError, NotFoundError } from "alepha/server";

import { EpicController } from "../../api/controllers/EpicController.ts";
import { ProjectController } from "../../api/controllers/ProjectController.ts";
import { QuestController } from "../../api/controllers/QuestController.ts";
import { ReleaseController } from "../../api/controllers/ReleaseController.ts";
import type { ReleaseResource } from "../../api/schemas/releaseResourceSchema.ts";
import {
  releaseAttachParamsSchema,
  releaseAttachResultSchema,
  releaseChangelogParamsSchema,
  releaseChangelogResultSchema,
  releaseCreateParamsSchema,
  releaseCreateResultSchema,
  releaseDeleteParamsSchema,
  releaseDeleteResultSchema,
  releaseDetachParamsSchema,
  releaseDetachResultSchema,
  releaseGetParamsSchema,
  releaseGetResultSchema,
  releaseListParamsSchema,
  releaseListResultSchema,
  releasePublishParamsSchema,
  releasePublishResultSchema,
  releaseReopenParamsSchema,
  releaseReopenResultSchema,
  releaseUpdateParamsSchema,
  releaseUpdateResultSchema,
} from "../schemas/index.ts";
import { ProjectTools } from "./ProjectTools.ts";

/**
 * MCP tools for releases.
 *
 * MCP is Lore's primary consumer, so the release surface has to be reachable
 * from an agent session or the feature does not exist for the way this project
 * is actually run.
 *
 * ⚠️ **A release is named by its TAG, everywhere here.** An agent writes
 * `0.28.0`, not `3`. `release_attach` / `release_detach` still name the EPIC or
 * the QUEST by its own per-project number, the way `quest_update`'s
 * `epic_number` does — only the release is named by tag.
 *
 * The `milestone_*` tools this replaces are gone with no aliases. The only
 * consumers are agent sessions in this repo and they read the tool list every
 * time; an alias that outlives the concept is worse than a rename an agent
 * notices once.
 */
export class ReleaseTools {
  protected readonly releaseController = $inject(ReleaseController);
  protected readonly projectController = $inject(ProjectController);
  protected readonly epicController = $inject(EpicController);
  protected readonly questController = $inject(QuestController);
  protected readonly projectTools = $inject(ProjectTools);

  /**
   * Resolve project ID from params (by ID or name).
   */
  protected async resolveProjectId(
    project?: number,
    projectName?: string,
  ): Promise<number> {
    // One implementation, in `ProjectTools`. See the note there.
    return await this.projectTools.resolveProjectId(project, projectName);
  }

  /**
   * Resolve a `(project, tag)` pair to the release itself.
   *
   * Case-sensitive, because a tag's case is preserved so it can match
   * `artifacts.tag` byte for byte — see `releaseTagSchema`.
   */
  protected async resolveRelease(params: {
    tag: string;
    project?: number;
    project_name?: string;
  }): Promise<ReleaseResource> {
    const projectId = await this.resolveProjectId(
      params.project,
      params.project_name,
    );
    const found = (
      await this.releaseController.getReleases({ params: { projectId } })
    ).find((release) => release.tag === params.tag);
    if (!found) {
      throw new NotFoundError(
        `Release '${params.tag}' not found in this project`,
      );
    }
    return found;
  }

  protected row(release: ReleaseResource) {
    return {
      number: release.number,
      tag: release.tag,
      title: release.title,
      description: release.description,
      targetDate: release.targetDate,
      releasedAt: release.releasedAt,
      progress: release.progress,
      createdAt: release.createdAt,
    };
  }

  /**
   * Re-read a release after a write, so the result carries the fresh rollup
   * rather than the row the mutation happened to return.
   */
  protected async reread(
    projectId: number,
    id: number,
  ): Promise<ReleaseResource> {
    const found = (
      await this.releaseController.getReleases({ params: { projectId } })
    ).find((release) => release.id === id);
    if (!found) throw new NotFoundError("Release not found");
    return found;
  }

  release_list = $tool({
    description:
      "List every release in a project, open and published. A release HOLDS the epics and quests assigned to it: membership is an assignment, not a time window, and nothing is in a release because it happened to be finished while the release was open. " +
      "SEVERAL RELEASES ARE OPEN AT ONCE and that is the normal state - `0.28.0`, `1.0.0` and `1.1.0` coexist, and a hotfix is a new release beside the one it patches rather than a state on it. " +
      "Sorted by release number ASCENDING, never by tag: `0.10.0` sorts before `0.9.0` as text. Each entry carries its tag, its target date, whether it has been published, and the progress rollup.",
    title: "List releases",
    annotations: { readOnlyHint: true, idempotentHint: true },
    schema: {
      params: releaseListParamsSchema,
      result: releaseListResultSchema,
    },
    handler: async ({ params }) => {
      const projectId = await this.resolveProjectId(
        params.project,
        params.project_name,
      );
      const releases = await this.releaseController.getReleases({
        params: { projectId },
      });

      return {
        releases: [...releases]
          .sort((a, b) => a.number - b.number)
          .map((release) => this.row(release)),
      };
    },
  });

  release_get = $tool({
    description:
      "One release by tag, with the epics attached to it (each with its own progress inside this release) and the quests attached directly. This is what 'what is in 0.28.0' means. " +
      "A published release reports its FROZEN progress counts: they are what it shipped, not what its quests say today.",
    title: "Get release",
    annotations: { readOnlyHint: true, idempotentHint: true },
    schema: {
      params: releaseGetParamsSchema,
      result: releaseGetResultSchema,
    },
    handler: async ({ params }) => {
      const release = await this.resolveRelease(params);
      const contents = await this.releaseController.getReleaseContents({
        params: { id: release.id },
      });

      return {
        ...this.row(release),
        epics: contents.epics.map((epic) => ({
          number: epic.number,
          title: epic.title,
          status: epic.status,
          completed: epic.completed,
          total: epic.total,
        })),
        // Mapped field by field rather than passed through. The endpoint
        // also carries `id`, `acceptedAt` and `shelvedAt` now, for the
        // release page's own rows; an agent reading a release wants the
        // reference and the title, and a tool result is a token budget.
        looseQuests: contents.looseQuests.map((quest) => ({
          shortId: quest.shortId,
          title: quest.title,
          area: quest.area,
          priority: quest.priority,
          completedAt: quest.completedAt,
        })),
      };
    },
  });

  release_create = $tool({
    description:
      "Create a release. The tag is required and is the release's identity: `0.28.0`, `demo-1`, `v1.0.0-rc.1`. Title and description are optional and the title defaults to the tag. " +
      "Any number of releases may be open at once, so this never has to wait for another one to be published.",
    title: "Create release",
    annotations: { readOnlyHint: false, destructiveHint: false },
    schema: {
      params: releaseCreateParamsSchema,
      result: releaseCreateResultSchema,
    },
    handler: async ({ params }) => {
      const projectId = await this.resolveProjectId(
        params.project,
        params.project_name,
      );
      const created = await this.releaseController.createRelease({
        params: { projectId },
        body: {
          tag: params.tag,
          title: params.title,
          description: params.description,
          targetDate: params.targetDate,
        },
      });

      return this.row(await this.reread(projectId, created.id));
    },
  });

  release_update = $tool({
    description:
      "Edit an OPEN release: its tag, title, description or target date. Refused once the release has been published - what a published release says is its record. " +
      "⚠️ Changing the tag MOVES the release's URL (`/<project>/releases/<tag>`) and breaks every link already shared to it. There is no redirect and no tag history. The UI puts a confirmation in front of this; you have none, so only retag when that is what was actually asked for.",
    title: "Update release",
    annotations: { readOnlyHint: false, destructiveHint: false },
    schema: {
      params: releaseUpdateParamsSchema,
      result: releaseUpdateResultSchema,
    },
    handler: async ({ params }) => {
      const release = await this.resolveRelease(params);
      await this.releaseController.updateRelease({
        params: { id: release.id },
        body: {
          ...(params.new_tag !== undefined ? { tag: params.new_tag } : {}),
          ...(params.title !== undefined ? { title: params.title } : {}),
          ...(params.description !== undefined
            ? { description: params.description }
            : {}),
          // An empty string clears the estimate; `null` is what the API takes
          // for that, and an omitted key means leave alone.
          ...(params.targetDate !== undefined
            ? { targetDate: params.targetDate || null }
            : {}),
        },
      });

      return this.row(await this.reread(release.projectId, release.id));
    },
  });

  release_publish = $tool({
    description:
      "Publish a release: stamps its release date and FREEZES both its changelog and its four progress counts onto the row. " +
      "ONE-WAY. Afterwards nothing can be attached or detached, the release cannot be edited, and the counts are never recomputed - so completing a quest next month does not rewrite what this release shipped. `release_reopen` is the only way back. " +
      "A hotfix is NOT a reopening: create the next release beside this one and publish that.",
    title: "Publish release",
    annotations: { readOnlyHint: false, destructiveHint: false },
    schema: {
      params: releasePublishParamsSchema,
      result: releasePublishResultSchema,
    },
    handler: async ({ params }) => {
      const release = await this.resolveRelease(params);
      await this.releaseController.publishRelease({
        params: { id: release.id },
        body: { title: params.title },
      });

      return this.row(await this.reread(release.projectId, release.id));
    },
  });

  release_reopen = $tool({
    description:
      "Undo a publication. For a release published by mistake: it clears the release date, the frozen changelog and the frozen progress counts, and the release goes back to being computed from what it contains. " +
      "The number and the tag survive, which is why this exists rather than delete-and-recreate. Not a normal step in a release's life - to ship a fix after publishing, create the next release instead.",
    title: "Reopen release",
    annotations: { readOnlyHint: false, destructiveHint: true },
    schema: {
      params: releaseReopenParamsSchema,
      result: releaseReopenResultSchema,
    },
    handler: async ({ params }) => {
      const release = await this.resolveRelease(params);
      await this.releaseController.reopenRelease({
        params: { id: release.id },
      });

      return this.row(await this.reread(release.projectId, release.id));
    },
  });

  release_attach = $tool({
    description:
      "Put an epic or a quest in a release. Pass `epic_number` for an epic or `quest_shortId` for loose work; each is named by its own per-project number, only the release is named by tag. " +
      "An epic belongs to at most one release, so attaching it here takes it out of whichever release it was in. Refused when the release has been published.",
    title: "Attach to release",
    annotations: { readOnlyHint: false, destructiveHint: false },
    schema: {
      params: releaseAttachParamsSchema,
      result: releaseAttachResultSchema,
    },
    handler: async ({ params }) => {
      const release = await this.resolveRelease(params);
      await this.move(release, params, release.id);
      return { ok: true, tag: release.tag ?? "" };
    },
  });

  release_detach = $tool({
    description:
      "Take an epic or a quest out of a release, leaving it in no release at all. Refused when the release has been published: a published release's contents are its record, and removing something would quietly edit what it shipped.",
    title: "Detach from release",
    annotations: { readOnlyHint: false, destructiveHint: false },
    schema: {
      params: releaseDetachParamsSchema,
      result: releaseDetachResultSchema,
    },
    handler: async ({ params }) => {
      const release = await this.resolveRelease(params);
      await this.move(release, params, null);
      return { ok: true, tag: release.tag ?? "" };
    },
  });

  release_changelog = $tool({
    description:
      "The release's changelog as Markdown: an epic heading per attached epic, then the loose quests under the area they were done in. Only COMPLETED quests appear - planned work is in the release without being in its changelog, and `release_get` is what reports both sides. " +
      "Computed live while the release is open; once published it is the frozen snapshot of what it shipped and does not move again.",
    title: "Release changelog",
    annotations: { readOnlyHint: true, idempotentHint: true },
    schema: {
      params: releaseChangelogParamsSchema,
      result: releaseChangelogResultSchema,
    },
    handler: async ({ params }) => {
      const release = await this.resolveRelease(params);
      const result = await this.releaseController.getReleaseChangelog({
        params: { id: release.id },
      });

      return {
        markdown: result.markdown,
        frozen: !!release.releasedAt,
        stats: result.stats,
      };
    },
  });

  release_delete = $tool({
    description:
      "Delete a release. Cheap and safe: the epics and quests in it are detached, never deleted, so nothing is lost but the row and its number. Allowed on a published release too.",
    title: "Delete release",
    annotations: { readOnlyHint: false, destructiveHint: true },
    schema: {
      params: releaseDeleteParamsSchema,
      result: releaseDeleteResultSchema,
    },
    handler: async ({ params }) => {
      const release = await this.resolveRelease(params);
      await this.releaseController.deleteRelease({
        params: { id: release.id },
      });
      return { ok: true };
    },
  });

  /**
   * Attach (`releaseId` set) or detach (`null`), for whichever of the two
   * targets the caller named.
   *
   * Shared by `release_attach` and `release_detach` because they differ in
   * exactly one value. The refusal on a published release lives in
   * `ReleaseAttachmentService`, which both write paths below call.
   */
  protected async move(
    release: ReleaseResource,
    params: { epic_number?: number; quest_shortId?: number },
    releaseId: number | null,
  ): Promise<void> {
    if (params.epic_number == null && params.quest_shortId == null) {
      throw new BadRequestError(
        "Pass `epic_number` or `quest_shortId` to say what to move.",
      );
    }

    if (params.epic_number != null) {
      const epic = await this.epicController.getEpicByNumber({
        params: { projectId: release.projectId, number: params.epic_number },
      });
      await this.epicController.updateEpic({
        params: { id: epic.id },
        body: { releaseId },
      });
    }

    if (params.quest_shortId != null) {
      const quest = await this.questController.getQuestByShortId({
        params: {
          projectId: release.projectId,
          shortId: params.quest_shortId,
        },
      });
      await this.questController.updateQuestById({
        params: { id: quest.id },
        body: { releaseId },
      });
    }
  }
}
