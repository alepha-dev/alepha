import { $repository } from "alepha/orm";
import { BadRequestError } from "alepha/server";

import { type Epic, epics } from "../entities/epics.ts";

/**
 * What `epics.dependsOn` is allowed to say, and what order it puts epics in.
 *
 * Both halves live here rather than in `EpicController` because the roadmap
 * needs the ordering and the controller needs the validation, and a graph
 * walk written twice is a graph walk that disagrees with itself.
 */
export class EpicDependencyService {
  epics = $repository(epics);

  /**
   * Validate a proposed predecessor and return the id to store.
   *
   * `null` clears the link and is always accepted. Anything else must be an
   * epic of the SAME project, must not be the epic itself, and must not close
   * a cycle.
   *
   * @param epicId the epic being written, or `undefined` on create - where
   *   there is no row yet, so neither a self-reference nor a cycle can exist.
   */
  async resolve(
    projectId: number,
    epicId: number | undefined,
    dependsOn: number | null,
  ): Promise<number | null> {
    if (dependsOn === null) {
      return null;
    }

    if (epicId !== undefined && dependsOn === epicId) {
      throw new BadRequestError("An epic cannot depend on itself");
    }

    const predecessor = await this.epics.findOne({
      where: { id: { eq: dependsOn }, projectId: { eq: projectId } },
    });
    if (!predecessor) {
      throw new BadRequestError("dependsOn epic not found in this project");
    }

    if (epicId !== undefined) {
      await this.assertNoCycle(projectId, epicId, dependsOn);
    }

    return dependsOn;
  }

  /**
   * Refuse a write that would close a loop.
   *
   * ⚠️ This is NOT the workflow gate the column's own comment settles - that
   * one is about when an epic may BEGIN, and lives on `EpicWorkflowService`.
   * A cycle is a different thing entirely: `A → B → A` is a graph the roadmap
   * cannot draw and {@link order} cannot terminate on, and a self-reference
   * with no constraint behind it is the only place one can be created. So it
   * is refused on write, always, whatever the workflow rules are.
   *
   * Walks forward from the PROPOSED predecessor. If the epic being written is
   * reachable that way, storing the link would close the loop.
   *
   * ⚠️ `quests.dependsOn` refuses a self-reference and nothing longer, so a
   * quest chain CAN be looped today. Known, and left alone here: fixing it is
   * a change to a gate people already rely on, not a side effect of adding
   * this column.
   */
  protected async assertNoCycle(
    projectId: number,
    epicId: number,
    dependsOn: number,
  ): Promise<void> {
    // One query for the whole project's edges rather than a walk that queries
    // per hop: a project has tens of epics, and the chain length is not known
    // in advance.
    const rows = await this.epics.findMany({
      where: { projectId: { eq: projectId } },
      columns: ["id", "dependsOn"],
    });

    const predecessorOf = new Map<number, number | undefined>();
    for (const row of rows) {
      predecessorOf.set(row.id, row.dependsOn ?? undefined);
    }
    // The write being validated, applied in memory - the stored row still
    // carries the old value.
    predecessorOf.set(epicId, dependsOn);

    const seen = new Set<number>();
    let cursor: number | undefined = epicId;
    while (cursor !== undefined) {
      // A loop anywhere upstream, including one this write did not create,
      // stops the walk rather than hanging it.
      if (seen.has(cursor)) {
        throw new BadRequestError(
          "That would make the epic depend on itself through another epic",
        );
      }
      seen.add(cursor);
      cursor = predecessorOf.get(cursor);
    }
  }

  /**
   * Epics sorted so a predecessor always comes before the epics that depend
   * on it, falling back to `number` for anything the graph does not order.
   *
   * A roadmap that lists `0.2.0`'s epics in creation order while one of them
   * says "after Epic 7" is asking the reader to do the sort themselves, which
   * is the whole thing this column exists to stop.
   *
   * Deliberately total and never throwing: it is a rendering helper, and a
   * page must not fail to draw because of a cycle. A cycle cannot be written
   * through {@link resolve}, but rows predating it - or written by a future
   * path that forgets to call it - fall back to `number` order rather than
   * looping. `seen` is what makes that a fallback and not a hang.
   */
  order<T extends Pick<Epic, "id" | "number" | "dependsOn">>(list: T[]): T[] {
    const byId = new Map(list.map((epic) => [epic.id, epic]));
    const byNumber = [...list].sort((a, b) => a.number - b.number);

    const placed = new Set<number>();
    const result: T[] = [];

    const visit = (epic: T, seen: Set<number>): void => {
      if (placed.has(epic.id) || seen.has(epic.id)) return;
      seen.add(epic.id);
      // A predecessor outside this list - in another release, say - orders
      // nothing here and is simply skipped.
      const predecessor =
        epic.dependsOn != null ? byId.get(epic.dependsOn) : undefined;
      if (predecessor) visit(predecessor, seen);
      if (placed.has(epic.id)) return;
      placed.add(epic.id);
      result.push(epic);
    };

    for (const epic of byNumber) {
      visit(epic, new Set());
    }

    return result;
  }
}
