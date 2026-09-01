import { $inject } from "alepha";
import { $repository } from "alepha/orm";

import { epics } from "../entities/epics.ts";
import type { Project } from "../entities/projects.ts";
import { quests } from "../entities/quests.ts";
import { releases } from "../entities/releases.ts";
import type { RoadmapEpic } from "../schemas/roadmapEpicSchema.ts";
import type { RoadmapRelease } from "../schemas/roadmapReleaseSchema.ts";
import type { RoadmapResource } from "../schemas/roadmapResourceSchema.ts";
import { EpicDependencyService } from "./EpicDependencyService.ts";
import { ReleaseContentService } from "./ReleaseContentService.ts";

/**
 * Builds the roadmap: a project's releases and the epics inside them, trimmed
 * to what `roadmapResourceSchema` declares.
 *
 * One service for both audiences. The members page and the public page differ
 * in **who may call**, never in what is computed - a response whose shape
 * depends on who is asking is how a leak survives a green test.
 *
 * Rollups come from {@link ReleaseContentService}, never from a count of this
 * service's own, because "what is in this release" already has one answer and
 * a second one drifts silently.
 */
export class RoadmapService {
  releases = $repository(releases);
  epics = $repository(epics);
  quests = $repository(quests);
  contents = $inject(ReleaseContentService);
  dependencies = $inject(EpicDependencyService);

  /**
   * Five queries for the whole page, whatever the project's size: the
   * releases, `contentsOfMany`'s two, one pass over the quests of every epic
   * on it, and one over the project's epics to turn a `dependsOn` id into
   * the `#7` a reader recognises. None of them grows with the project.
   */
  async roadmapOf(project: Project): Promise<RoadmapResource> {
    const rows = await this.releases.findMany({
      where: { projectId: { eq: project.id } },
      orderBy: [{ column: "number", direction: "asc" }],
    });

    // Only the open ones are looked up. A released release renders entirely
    // from the four counts frozen onto its own row - see
    // `ReleaseContentService.progressOf`.
    const open = rows.filter((release) => !release.releasedAt);
    const contents = await this.contents.contentsOfMany(project.id, open);

    const epicProgress = await this.epicProgressOf(
      [...contents.values()].flatMap((entry) => entry.epics.map((e) => e.id)),
    );

    // id → per-project number, for `dependsOnNumber`. Built over the whole
    // project rather than over the epics on the roadmap: a predecessor can
    // sit in a release that is not open, or in none at all, and the card
    // still has to be able to name it.
    const numberById = new Map(
      (
        await this.epics.findMany({
          where: { projectId: { eq: project.id } },
          columns: ["id", "number"],
        })
      ).map((epic) => [epic.id, epic.number]),
    );

    const toRelease = (release: (typeof rows)[number]): RoadmapRelease => ({
      tag: release.tag,
      title: release.title,
      description: release.description,
      targetDate: release.targetDate,
      releasedAt: release.releasedAt,
      progress: this.contents.progressOf(release, contents.get(release.id)),
      // Planned epics are included, on both audiences. An epic that is
      // specified and not started is exactly what a roadmap is for, and
      // `EpicVisibilityService`'s backlog gate is about the project's own
      // lists rather than about intent. Empty for a released release; see
      // `roadmapReleaseSchema`.
      //
      // Ordered so a predecessor precedes what depends on it, rather than by
      // `number`: a card that lists "Epic 9, after Epic 7" above "Epic 7" is
      // asking the reader to sort it themselves, which is the whole thing
      // `epics.dependsOn` exists to stop.
      epics: this.dependencies
        .order(contents.get(release.id)?.epics ?? [])
        .map((epic) => ({
          number: epic.number,
          title: epic.title,
          status: epic.status,
          // The predecessor's per-project number, never its id. `undefined`
          // for an epic whose predecessor is not in this project's epic set
          // at all, which cannot happen through `EpicDependencyService`.
          dependsOnNumber:
            epic.dependsOn != null ? numberById.get(epic.dependsOn) : undefined,
          progress: epicProgress.get(epic.id) ?? {
            completed: 0,
            inProgress: 0,
            shelved: 0,
            total: 0,
          },
        })),
    });

    return {
      project: { title: project.title },
      // Open first, in `number` order, then the shipped ones - which is the
      // order both pages render, so the client never re-sorts. The two halves
      // keep the ascending order the query produced.
      releases: [
        ...rows.filter((release) => !release.releasedAt).map(toRelease),
        ...rows.filter((release) => release.releasedAt).map(toRelease),
      ],
    };
  }

  /**
   * The epic rollup for a set of epics, in ONE query.
   *
   * ⚠️ Counts every quest whose `epicId` is the epic, which is the EPIC
   * convention (`EpicController.computeProgress`) and not the release one: a
   * quest of this epic that ships in a different release still belongs to the
   * epic, and `shelved` sits INSIDE `total` here. Two sibling rollups with the
   * same field names and different denominators is a trap, and the epic card
   * has to agree with the epic page rather than with the release around it.
   *
   * `EpicController` issues four `count()` queries per epic, which is fine for
   * one epic and is N+1 for a roadmap. Counted in memory here instead, over
   * four columns.
   */
  protected async epicProgressOf(
    epicIds: number[],
  ): Promise<Map<number, RoadmapEpic["progress"]>> {
    const result = new Map<number, RoadmapEpic["progress"]>();
    // `inArray: []` is not an empty match: `IN ()` is a SQL syntax error. A
    // roadmap whose releases carry no epics at all is the normal case for a
    // young project, not an edge case.
    if (epicIds.length === 0) return result;

    for (const id of epicIds) {
      result.set(id, { completed: 0, inProgress: 0, shelved: 0, total: 0 });
    }

    const rows = await this.quests.findMany({
      where: { epicId: { inArray: epicIds } },
      columns: ["epicId", "acceptedAt", "completedAt", "shelvedAt"],
    });

    for (const quest of rows) {
      if (quest.epicId == null) continue;
      const bucket = result.get(quest.epicId);
      if (!bucket) continue;
      bucket.total += 1;
      if (quest.completedAt != null) {
        bucket.completed += 1;
      } else if (quest.acceptedAt != null) {
        bucket.inProgress += 1;
      }
      if (quest.shelvedAt != null) {
        bucket.shelved += 1;
      }
    }

    return result;
  }
}
