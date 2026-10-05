import { $inject } from "alepha";

import { EpicController } from "../../api/controllers/EpicController.ts";
import { ReleaseController } from "../../api/controllers/ReleaseController.ts";
import { AreaService } from "../../api/services/AreaService.ts";
import { ProjectContextRegistry } from "./ProjectContextRegistry.ts";

/**
 * Work's sections of `project_context` and `project_info`, registered on
 * core's `ProjectContextRegistry` (#E75, #Q2623).
 */
export class WorkProjectContext {
  /**
   * Cap on each area's `description` as it crosses the MCP boundary.
   *
   * The area LIST is never capped: an agent that cannot see an existing area
   * name is exactly the agent that invents a new one, which is the regrowth
   * this exists to stop, so every area stays visible in full. Only each
   * entry's `description` is bounded, to keep the payload predictable.
   * `areas.description` carries no length limit at the entity level
   * (`meta({ size: "rich" })`), so this is the only thing standing between a
   * verbose write on the settings page and an unbounded MCP payload.
   */
  public static readonly AREA_DESCRIPTION_MAX_CHARS = 160;

  protected readonly registry = $inject(ProjectContextRegistry);
  protected readonly areaService = $inject(AreaService);
  protected readonly epicController = $inject(EpicController);
  protected readonly releaseController = $inject(ReleaseController);

  constructor() {
    // The `areas` table is the list. Only `name` + `description` cross the
    // MCP boundary: this is paid for on every orientation round-trip, and
    // the stats (`questCount`, dates) are a settings-page concern.
    this.registry.register({
      key: "work.areas",
      order: 10,
      capability: "work",
      context: async ({ projectId, assignedWork }) => ({
        areas: await this.areas(projectId),
        activeQuests: assignedWork.map((quest) => ({
          id: quest.id,
          shortId: quest.shortId,
          title: quest.title,
          area: quest.area,
          priority: quest.priority,
        })),
      }),
      info: async ({ projectId }) => ({ areas: await this.areas(projectId) }),
    });

    this.registry.register({
      key: "work.plan",
      order: 20,
      capability: "work",
      context: async ({ projectId }) => {
        // The epic index. Never gated on an epic's STATUS (same as an
        // epic's own view of itself): orientation is exactly what failed for
        // the work that motivated this, thirteen quests parked under one
        // epic read as noise with no signal they were one subject.
        const epics = await this.epicController.getEpics({
          params: { projectId },
        });
        // The open releases, so an agent opens a session already knowing
        // what `0.28.0` is meant to contain. Published ones are dropped:
        // this index is for planning into, and a shipped release is not.
        const openReleases = (
          await this.releaseController.getReleases({ params: { projectId } })
        )
          .filter((release) => !release.releasedAt)
          .sort((a, b) => a.number - b.number);
        return {
          epics: epics.map((epic) => ({
            number: epic.number,
            title: epic.title,
            status: epic.status,
            questCount: epic.questCount,
            // Beside the count, so "draft, 9 specified" and "draft, 9
            // shipped" are distinguishable at orientation. Epic #27 was
            // worked to 9 of 9 while `planned`, and this is the field that
            // would have shown it.
            completed: epic.progress.completed,
          })),
          openReleases: openReleases.map((release) => ({
            tag: release.tag,
            title: release.title,
            targetDate: release.targetDate,
            completed: release.progress.completed,
            total: release.progress.total,
            // Omitted rather than `false` on every other release: an
            // orientation payload pays for every key on every row.
            ...(release.defaultSince ? { default: true } : {}),
          })),
        };
      },
    });
  }

  /**
   * Every area, its description cut at
   * {@link WorkProjectContext.AREA_DESCRIPTION_MAX_CHARS} with an ellipsis.
   */
  protected async areas(
    projectId: number,
  ): Promise<Array<{ name: string; description: string }>> {
    const max = WorkProjectContext.AREA_DESCRIPTION_MAX_CHARS;
    return (await this.areaService.listWithStats(projectId)).map((area) => ({
      name: area.name,
      description:
        area.description.length > max
          ? `${area.description.slice(0, max)}…`
          : area.description,
    }));
  }
}
