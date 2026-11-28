import { $inject, Alepha } from "alepha";

import { EpicController } from "../../api/controllers/EpicController.ts";
import type { EpicResource } from "../../api/schemas/epicResourceSchema.ts";
import type { PullRequest } from "../../api/schemas/pullRequestSchema.ts";

/**
 * The epic stamped on a quest or folio row over MCP: the `number` an agent
 * addresses it by, its `title`, and its `status`. The status is the one
 * field that is not decoration: `folio_list` leaves no epic's folios out, and
 * `quest_list` named with `draft` among its statuses or with an `epic:`
 * filter returns a draft epic's quests, so one page can mix a draft epic's
 * rows with ready ones, and the status is what lets a caller tell them apart.
 */
export interface EpicRef {
  number: number;
  title: string;
  status: EpicResource["status"];
}

/**
 * Resolves epic ids to the ref above for the MCP tools.
 *
 * Shared by the quest and folio tools rather than copied into each: a quest
 * and a folio filed under the same epic have to describe it identically, and
 * a second copy is how one surface quietly stops carrying a field the other
 * still does. `mapFor` is the page shape (one call for up to 100 rows instead
 * of one per row); `refFor` is the single-row shape and skips the call
 * entirely when the row has no epic, which is the common case.
 */
export class EpicRefService {
  protected readonly alepha = $inject(Alepha);

  /**
   * Resolved on use, never held as a field: a field would make `EpicController`
   * injected by a boot service, so it could never be a pure controller
   * created on its first request (#Q3399).
   */
  protected epicController(): EpicController {
    return this.alepha.inject(EpicController);
  }

  /**
   * `epicId -> EpicRef` for every epic in a project.
   *
   * Through `getEpicRefs`, never `getEpics`: the ref is three columns, and
   * `getEpics` returns every epic with its `description` (222 KB on project
   * Lore) plus two progress aggregates, one extra D1 round trip on every
   * `quest_list` page and every `quest_get` of a quest in an epic (#Q2635).
   */
  async mapFor(projectId: number): Promise<Map<number, EpicRef>> {
    const projectEpics = await this.epicController().getEpicRefs({
      params: { projectId },
    });
    return new Map(
      projectEpics.map((epic) => [
        epic.id,
        { number: epic.number, title: epic.title, status: epic.status },
      ]),
    );
  }

  /**
   * The ref of one epic and the pull requests recorded on it (#Q3707), from
   * the same one read as {@link refFor}: `quest_get` shows a quest the
   * epic's pull requests when it has none of its own.
   */
  async refWithPullRequestsFor(
    projectId: number,
    epicId: number | null | undefined,
  ): Promise<{ ref?: EpicRef; pullRequests: PullRequest[] }> {
    if (epicId == null) return { pullRequests: [] };
    const epic = (
      await this.epicController().getEpicRefs({ params: { projectId } })
    ).find((row) => row.id === epicId);
    if (!epic) return { pullRequests: [] };
    return {
      ref: { number: epic.number, title: epic.title, status: epic.status },
      pullRequests: epic.pullRequests ?? [],
    };
  }

  /**
   * The ref of one epic, or `undefined` when the row has none.
   */
  async refFor(
    projectId: number,
    epicId: number | null | undefined,
  ): Promise<EpicRef | undefined> {
    if (epicId == null) return undefined;
    const refs = await this.mapFor(projectId);
    return refs.get(epicId);
  }
}
