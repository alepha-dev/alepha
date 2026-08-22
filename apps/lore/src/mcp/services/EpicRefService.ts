import { $inject } from "alepha";

import { EpicController } from "../../api/controllers/EpicController.ts";
import type { EpicResource } from "../../api/schemas/epicResourceSchema.ts";

/**
 * The epic stamped on a quest or folio row over MCP: the `number` an agent
 * addresses it by, its `title`, and its `status`. The status is the one
 * field that is not decoration: neither `quest_list` nor `folio_list` is
 * gated over MCP (design §5.3), so one page can mix a planned epic's rows
 * with released ones, and the status is what lets a caller tell them apart.
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
  protected readonly epicController = $inject(EpicController);

  /**
   * `epicId -> EpicRef` for every epic in a project.
   */
  async mapFor(projectId: number): Promise<Map<number, EpicRef>> {
    const projectEpics = await this.epicController.getEpics({
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
