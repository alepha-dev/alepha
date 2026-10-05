import { $inject, Alepha } from "alepha";
import { $client } from "alepha/server/links";

import type { AreaController } from "../../../api/controllers/AreaController.ts";
import type { EpicController } from "../../../api/controllers/EpicController.ts";
import type { FeedbackController } from "../../../api/controllers/FeedbackController.ts";
import type { QuestController } from "../../../api/controllers/QuestController.ts";
import type { ReleaseController } from "../../../api/controllers/ReleaseController.ts";
import { currentAreasAtom } from "../atoms/currentAreasAtom.ts";
import { currentAssignedQuestsAtom } from "../atoms/currentAssignedQuestsAtom.ts";
import { currentEpicCountAtom } from "../atoms/currentEpicCountAtom.ts";
import { currentEpicsAtom } from "../atoms/currentEpicsAtom.ts";
import { currentFeedbackCountAtom } from "../atoms/currentFeedbackCountAtom.ts";
import { currentQuestCountAtom } from "../atoms/currentQuestCountAtom.ts";
import { currentReleasesAtom } from "../atoms/currentReleasesAtom.ts";
import { ProjectLoaderRegistry } from "../registries/ProjectLoaderRegistry.ts";
import { capabilityOption } from "../services/projectCapabilities.ts";

/**
 * What Work reads when a project opens, registered on core's
 * `ProjectLoaderRegistry` (#E75, #Q2624): the viewer's open quests, the
 * releases, the badges' counts, the epic refs and the areas.
 */
export class WorkProjectLoader {
  protected readonly alepha = $inject(Alepha);
  protected readonly loaders = $inject(ProjectLoaderRegistry);
  protected readonly questApi = $client<QuestController>();
  protected readonly releaseApi = $client<ReleaseController>();
  protected readonly feedbackApi = $client<FeedbackController>();
  protected readonly epicApi = $client<EpicController>();
  protected readonly areaApi = $client<AreaController>();

  constructor() {
    this.loaders.register({
      key: "work",
      order: 10,
      load: async (project) => {
        const projectId = project.id;
        const [quests, releases, pendingFeedback, openQuests, epicRefs, areas] =
          await Promise.all([
            // The viewer's open quests, which rode on the project response
            // until core stopped reading Work's tables (#Q2623). `[]` on
            // failure, like the counts, rather than taking the project down.
            this.questApi
              .getMyActiveQuests({ params: { projectId } })
              .catch(() => []),

            // No `.catch`: a failure here rejects the loader, as it always
            // did when the releases were awaited first.
            this.releaseApi.getReleases({ params: { projectId } }),

            // Pending-feedback count for the sidebar badge. Fetched once per
            // project navigation instead of polled: accept/reject/remove
            // actions adjust the atom locally, so within-session math stays
            // correct. Errors count as 0 (the badge hides).
            //
            // `countFeedback`, not `listFeedback().items.length`: the list
            // pages at ten now, so counting it would cap the badge at 10 over
            // an inbox of 106 (#1744).
            this.feedbackApi
              .countFeedback({
                params: { projectId },
                query: { status: "pending" },
              })
              .then((r) => r.count)
              .catch(() => 0),

            // Open-quest count for the sidebar badge. Member-readable;
            // `.catch` keeps a transient error from blocking the whole
            // project load (badge just hides).
            this.questApi
              .countOpenQuests({ params: { projectId } })
              .then((r) => r.count)
              .catch(() => 0),

            // Every epic as a ref, which serves two readers at once: the
            // sidebar's draft-epic badge, counted locally below, and the
            // quests table's Epic column, which resolves `quests.epicId`
            // against it exactly as the Release column resolves `releaseId`
            // against `currentReleasesAtom`. `getEpicRefs` and not
            // `getEpics`: the full resource carries `description`, which is
            // 213 KB of the 222 KB this project's own epic list weighs.
            //
            // Gated on the same `work.epics` option that decides whether the
            // Epics entry renders at all, so a project with epics off pays
            // nothing. `undefined` on failure and NOT `[]`, like
            // `currentInstancesAtom`: the badge must read "could not count"
            // rather than "no drafts".
            capabilityOption(project, "work", "epics")
              ? this.epicApi
                  .getEpicRefs({ params: { projectId } })
                  .catch(() => undefined)
              : Promise.resolve([]),

            // The one list every area picker reads. `.catch` keeps a
            // transient failure from taking the page down: an empty picker
            // costs a picker, an unhandled rejection costs the project.
            this.areaApi
              .getAreas({ params: { projectId } })
              .catch(() => undefined),
          ]);

        return () => {
          const store = this.alepha.store;
          store.set(currentAssignedQuestsAtom, quests);
          store.set(currentReleasesAtom, releases);
          store.set(currentFeedbackCountAtom, { count: pendingFeedback });
          store.set(currentQuestCountAtom, { count: openQuests });
          store.set(currentEpicsAtom, epicRefs);
          // Counted here rather than server-side, the same way
          // `ProjectEpics` counts it off the list it already holds.
          // `undefined` means the read failed, and 0 is the honest answer
          // for a badge that can only hide.
          store.set(currentEpicCountAtom, {
            count: (epicRefs ?? []).filter((epic) => epic.status === "draft")
              .length,
          });
          store.set(currentAreasAtom, areas);
        };
      },
      leave: () => {
        const store = this.alepha.store;
        store.set(currentAssignedQuestsAtom, []);
        store.set(currentReleasesAtom, undefined);
        store.set(currentFeedbackCountAtom, { count: 0 });
        store.set(currentQuestCountAtom, { count: 0 });
        store.set(currentEpicCountAtom, { count: 0 });
        store.set(currentEpicsAtom, undefined);
        store.set(currentAreasAtom, undefined);
      },
    });
  }
}
