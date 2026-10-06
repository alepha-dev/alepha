import { LoreCoreWeb } from "@lore/core/web";
import { $module } from "alepha";

import { WorkDashboardMetrics } from "../api/services/WorkDashboardMetrics.ts";
import { currentAssignedQuestsAtom } from "./app/atoms/currentAssignedQuestsAtom.ts";
import { currentEpicsAtom } from "./app/atoms/currentEpicsAtom.ts";
import { currentQuestAtom } from "./app/atoms/currentQuestAtom.ts";
import { currentReleasesAtom } from "./app/atoms/currentReleasesAtom.ts";
import { kanbanFiltersAtom } from "./app/atoms/kanbanFiltersAtom.ts";
import { kanbanReloadAtom } from "./app/atoms/kanbanReloadAtom.ts";
import { questLogCollapsedAtom } from "./app/atoms/questLogCollapsedAtom.ts";
import { WorkAccountRouter } from "./app/components/account/feedback/WorkAccountRouter.ts";
import { WorkProjectLoader } from "./app/loaders/WorkProjectLoader.ts";
import { WorkShell } from "./app/shell/WorkShell.ts";
import { WorkRouter } from "./app/WorkRouter.ts";

/**
 * The browser-safe half of `@lore/work`, Lore as Jira: quests, epics, releases, areas, the kanban, the roadmap and feedback: its pages, atoms and
 * dictionaries.
 *
 * Registered by BOTH entries, `main.server.ts` and `main.browser.ts`: the
 * server renders and the browser hydrates from the same page registry, so a
 * page known to one side only renders on the server and 404s after hydration.
 *
 * It imports another package's `./api` or `./mcp` as `import type` only:
 * a runtime import would bundle that package's server into the browser.
 *
 * @module
 */
export const LoreWorkWeb = $module({
  name: "lore.work.web",
  // Core first: booting this module alone boots what it depends on.
  imports: [LoreCoreWeb],
  atoms: [
    currentAssignedQuestsAtom,
    currentReleasesAtom,
    currentEpicsAtom,
    currentQuestAtom,
    kanbanFiltersAtom,
    kanbanReloadAtom,
    // Registered here, unlike most of the `current*` atoms, so the cookie
    // value is hydrated before the first render that reads it. An
    // unregistered `persist: "cookie"` atom still persists, lazily, on its
    // first read.
    questLogCollapsedAtom,
  ],
  register(alepha) {
    // Injected rather than listed in `services`: a listed service is tagged
    // with this module, and injecting it anywhere (a spec, a component
    // importing it from the barrel) would then register the whole module.
    //
    // The pages; Work's account page; its part of opening a project and of
    // the project shell (sidebar, settings, create menu, breadcrumbs,
    // references, tabs, prompts, pickers), on core's registries, which
    // nothing else would construct; and its dashboard metrics' declarative
    // half, which the browser needs to draw the tiles.
    alepha.inject(WorkRouter);
    alepha.inject(WorkAccountRouter);
    alepha.inject(WorkProjectLoader);
    alepha.inject(WorkShell);
    alepha.inject(WorkDashboardMetrics);
  },
});

// What code outside `src/` imports from this barrel: the entries, other
// packages and the specs (`apps/lore/test`, `apps/e2e`, Work's own `test/`).
// Everything else stays internal, reached by relative import.

export { WorkRouter } from "./app/WorkRouter.ts";
export { currentReleasesAtom } from "./app/atoms/currentReleasesAtom.ts";
export { WorkAccountRouter } from "./app/components/account/feedback/WorkAccountRouter.ts";
export {
  expandCommentReferences,
  outsideProtected,
} from "./app/components/project/quest/commentReferences.ts";
export { buildQuestDiscussionEntries } from "./app/components/project/quest/questDiscussionEntries.ts";
export {
  ESTIMATE_PRESETS,
  formatEstimate,
} from "./app/components/project/quest/questEstimate.ts";
export { epicReviewPromptDefault } from "./app/prompts/epicReviewPrompt.ts";
export { feedbackWorkPromptDefault } from "./app/prompts/feedbackWorkPrompt.ts";
export { questLoopPromptDefault } from "./app/prompts/questLoopPrompt.ts";
export { WorkShell } from "./app/shell/WorkShell.ts";
