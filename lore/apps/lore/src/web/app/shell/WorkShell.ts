import { $inject } from "alepha";
import {
  Columns3,
  Flag,
  Grid3x2,
  Inbox,
  Layers,
  MessageSquarePlus,
  ScrollText,
  Swords,
} from "lucide-react";

import { currentEpicAtom } from "../atoms/currentEpicAtom.ts";
import { currentEpicCountAtom } from "../atoms/currentEpicCountAtom.ts";
import { currentFeedbackCountAtom } from "../atoms/currentFeedbackCountAtom.ts";
import { currentQuestAtom } from "../atoms/currentQuestAtom.ts";
import { currentQuestCountAtom } from "../atoms/currentQuestCountAtom.ts";
import EpicCreateMenuSheet from "../components/project/epics/EpicCreateMenuSheet.tsx";
import ProjectQuestLogAside from "../components/project/ProjectQuestLogAside.tsx";
import { ROUTES_WITH_QUEST_LOG } from "../components/project/projectViewRoutes.ts";
import QuestCreateMenuSheet from "../components/project/quest/QuestCreateMenuSheet.tsx";
import ReleaseCreateMenuDialog from "../components/project/releases/ReleaseCreateMenuDialog.tsx";
import { formatReference } from "../components/shared/element/typedReference.ts";
import { ProjectShellRegistry } from "../registries/ProjectShellRegistry.ts";
import {
  capabilityOption,
  hasCapability,
} from "../services/projectCapabilities.ts";
import { canInProject } from "../services/projectRank.ts";

/**
 * Work's part of the project shell, registered on core's
 * `ProjectShellRegistry` (#E75, #Q2624): the Quests, Kanban, Epics, Releases
 * and Feedback entries with their badges, the Quests settings section, the
 * quest, epic, release and feedback creates, the epic, quest and release
 * breadcrumb leaves, and the quest log beside the Quests pages.
 */
export class WorkShell {
  protected readonly shell = $inject(ProjectShellRegistry);

  constructor() {
    this.shell.registerNav("work", [
      {
        route: "projectQuests",
        permission: "quest:read",
        labelKey: "project.menu.quests",
        icon: Grid3x2,
        group: "work",
        order: 10,
        // Highlighted from anywhere under Quests, not just the list: opening
        // a quest used to clear the sidebar entirely, so the one page you
        // were deepest inside was the one that said where you were not.
        activeOn: (name) =>
          name === "projectQuests" ||
          name === "project" ||
          name === "projectQuest" ||
          name === "projectQuestGraph",
        reads: [currentQuestCountAtom],
        badge: (ctx) => ctx.get(currentQuestCountAtom)?.count || undefined,
      },
      {
        // A destination, so it gets an entry of its own. It had one until the
        // 2026-08 rename took it, which is why `ProjectQuestsViewSwitcher`
        // had to be invented - the board was unreachable from the UI at all.
        route: "projectKanban",
        permission: "quest:read",
        labelKey: "project.menu.kanban",
        icon: Columns3,
        group: "work",
        order: 20,
        option: "board",
      },
      {
        // A lens on quests, so it sits right after them: scope, then the
        // items.
        route: "projectEpics",
        permission: "epic:read",
        labelKey: "project.menu.epics",
        icon: Layers,
        group: "work",
        order: 30,
        option: "epics",
        activeOn: (name) => name === "projectEpics" || name === "projectEpic",
        // Draft epics only. A draft epic is a gate holding its quests out of
        // the Quests count beside it, so this is the sidebar's only trace of
        // that work.
        reads: [currentEpicCountAtom],
        badge: (ctx) => ctx.get(currentEpicCountAtom)?.count || undefined,
      },
      {
        // Between Folios and Reports.
        route: "projectReleases",
        permission: "release:read",
        labelKey: "project.menu.releases",
        icon: Flag,
        group: "record",
        order: 20,
        option: "releases",
        activeOn: (name) =>
          name === "projectReleases" || name === "projectRelease",
      },
    ]);

    this.shell.registerNav("support", [
      {
        // Arrived rather than chosen. Feedback leads because a human wrote
        // it; a blight is filed by a machine.
        route: "projectFeedback",
        permission: "feedback:read",
        labelKey: "project.menu.feedback",
        icon: Inbox,
        group: "work",
        order: 40,
        reads: [currentFeedbackCountAtom],
        badge: (ctx) => ctx.get(currentFeedbackCountAtom)?.count || undefined,
      },
    ]);

    this.shell.registerSettings({
      key: "work",
      order: 30,
      labelKey: "project.menu.quests",
      descriptionKey: "project.settings.section.work",
      icon: Swords,
      capability: "work",
      tabs: [
        {
          route: "projectSettingsWork",
          labelKey: "project.settings.tab.features",
        },
        {
          // Areas moved here from the top of the old rail: a quest carries an
          // area and a blight forwards into one, so the page serves Work.
          route: "projectSettingsAreas",
          labelKey: "project.settings.nav.areas",
          alsoOn: ["projectSettingsArea"],
        },
        {
          route: "projectSettingsBoard",
          labelKey: "project.settings.tab.board",
          option: "board",
        },
        {
          route: "projectSettingsPrompts",
          labelKey: "project.settings.tab.prompts",
          option: "agentPrompts",
        },
      ],
    });

    // ⚠️ New quest was once the one item gated on the PERMISSION alone. It
    // left a Knowledge-only project offering the one create that answers
    // 400 - the first thing a reader would try.
    this.shell.registerCreate({
      key: "quest",
      order: 10,
      primary: true,
      labelKey: "project.menu.create-quest",
      icon: ScrollText,
      enabled: (project) =>
        hasCapability(project, "work") && canInProject(project, "quest:create"),
      dialog: QuestCreateMenuSheet,
    });
    this.shell.registerCreate({
      key: "epic",
      order: 20,
      labelKey: "project.menu.create-epic",
      icon: Layers,
      enabled: (project) =>
        capabilityOption(project, "work", "epics") &&
        canInProject(project, "epic:write"),
      dialog: EpicCreateMenuSheet,
    });
    // Directly after New Epic, matching the sidebar's Epics then Releases: a
    // release is when the epic ships. `releases` is the key
    // `features.milestones` should always have had.
    this.shell.registerCreate({
      key: "release",
      order: 30,
      labelKey: "project.menu.create-release",
      icon: Flag,
      enabled: (project) =>
        capabilityOption(project, "work", "releases") &&
        canInProject(project, "release:manage"),
      dialog: ReleaseCreateMenuDialog,
    });
    // Not rank-gated: this row navigates to the first-party request form,
    // which any signed-in user may submit through - membership is not its
    // gate, so a rank is not either.
    this.shell.registerCreate({
      key: "feedback",
      order: 60,
      labelKey: "project.menu.create-feedback",
      icon: MessageSquarePlus,
      enabled: (project) => hasCapability(project, "support"),
      route: "projectFeedbackRequest",
    });

    // The epic detail page contributes the epic's own `#number` as a leaf,
    // so the header reads "Project > Epics > #2". No `href`: the leaf is the
    // page already open.
    //
    // The number, not the title, for the reason the quest leaf gives and one
    // more: the title heads `ProjectEpicAside`, immediately under this bar,
    // so a crumb repeating it would put the same words twice on screen a few
    // pixels apart.
    this.shell.registerCrumb({
      order: 20,
      reads: [currentEpicAtom],
      crumb: (ctx) => {
        const epic = ctx.get(currentEpicAtom);
        return ctx.routeName === "projectEpic" && epic
          ? { label: formatReference("epic", epic.number) }
          : undefined;
      },
    });
    // Same shape for the quest detail page: `#1208` as an inert leaf. The
    // number, not the title: the title is already the first thing on the
    // page, and a long one would push the crumbs off the bar.
    this.shell.registerCrumb({
      order: 30,
      reads: [currentQuestAtom],
      crumb: (ctx) => {
        const quest = ctx.get(currentQuestAtom);
        return ctx.routeName === "projectQuest" && quest
          ? { label: formatReference("quest", quest.shortId) }
          : undefined;
      },
    });
    // The release detail page contributes its TAG, the one leaf on this bar
    // that is not a `#number`: the number is the internal sequence and nobody
    // reading the bar knows it. Read straight from the route params, as the
    // route has no loader and no atom of its own.
    this.shell.registerCrumb({
      order: 40,
      crumb: (ctx) =>
        ctx.routeName === "projectRelease" && ctx.params.releaseTag
          ? { label: String(ctx.params.releaseTag) }
          : undefined,
    });

    this.shell.registerAside({
      key: "quest-log",
      routes: [...ROUTES_WITH_QUEST_LOG],
      component: ProjectQuestLogAside,
    });
  }
}
