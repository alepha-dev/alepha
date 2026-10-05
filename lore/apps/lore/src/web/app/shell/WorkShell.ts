import { $inject } from "alepha";
import {
  ClipboardCheck,
  Columns3,
  Flag,
  Grid3x2,
  Inbox,
  Layers,
  ListChecks,
  ListTodo,
  MessageSquarePlus,
  ScrollText,
  Swords,
  Wrench,
} from "lucide-react";

import { currentEpicAtom } from "../atoms/currentEpicAtom.ts";
import { currentEpicCountAtom } from "../atoms/currentEpicCountAtom.ts";
import { currentFeedbackCountAtom } from "../atoms/currentFeedbackCountAtom.ts";
import { currentQuestAtom } from "../atoms/currentQuestAtom.ts";
import { currentQuestCountAtom } from "../atoms/currentQuestCountAtom.ts";
import EpicCreateMenuSheet from "../components/project/epics/EpicCreateMenuSheet.tsx";
import EpicReferencePreview from "../components/project/epics/EpicReferencePreview.tsx";
import { useEpicReferences } from "../components/project/epics/useEpicReferences.ts";
import FeedbackReferencePreview from "../components/project/feedback/FeedbackReferencePreview.tsx";
import { useFeedbackReferences } from "../components/project/feedback/useFeedbackReferences.ts";
import ProjectQuestLogAside from "../components/project/ProjectQuestLogAside.tsx";
import { ROUTES_WITH_QUEST_LOG } from "../components/project/projectViewRoutes.ts";
import QuestCreateMenuSheet from "../components/project/quest/QuestCreateMenuSheet.tsx";
import QuestReferencePreview from "../components/project/quest/QuestReferencePreview.tsx";
import { useQuestElementImageUpload } from "../components/project/quest/useQuestElementImageUpload.ts";
import { useQuestReferences } from "../components/project/quest/useQuestReferences.ts";
import ReleaseCreateMenuDialog from "../components/project/releases/ReleaseCreateMenuDialog.tsx";
import ReleaseReferencePreview from "../components/project/releases/ReleaseReferencePreview.tsx";
import { useReleaseReferences } from "../components/project/releases/useReleaseReferences.ts";
import ProjectSettingsDataSection from "../components/project/settings/ProjectSettingsDataSection.tsx";
import { formatReference } from "../components/shared/element/typedReference.ts";
import { epicActivatePromptDefault } from "../prompts/epicActivatePrompt.ts";
import { epicReviewPromptDefault } from "../prompts/epicReviewPrompt.ts";
import { feedbackLoopPromptDefault } from "../prompts/feedbackLoopPrompt.ts";
import { feedbackWorkPromptDefault } from "../prompts/feedbackWorkPrompt.ts";
import { questLoopPromptDefault } from "../prompts/questLoopPrompt.ts";
import { questWorkPromptDefault } from "../prompts/questWorkPrompt.ts";
import { AgentPromptRegistry } from "../registries/AgentPromptRegistry.ts";
import { ElementReferenceRegistry } from "../registries/ElementReferenceRegistry.ts";
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
 * breadcrumb leaves, the quest log beside the Quests pages, the quest, epic,
 * feedback and release `[[...]]` references, and the agent prompt kinds.
 */
export class WorkShell {
  protected readonly shell = $inject(ProjectShellRegistry);
  protected readonly references = $inject(ElementReferenceRegistry);
  protected readonly prompts = $inject(AgentPromptRegistry);

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

    // The quest export, on General since it is the project's data rather
    // than a Quests setting.
    this.shell.registerSettingsPanel({
      key: "quest-export",
      section: "general",
      order: 10,
      component: ProjectSettingsDataSection,
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

    // Picker order: after folios, and epics after quests because a project
    // has far fewer of them, so they are rarely what a prefix-free search
    // is reaching for. Feedback and releases are resolved, not offered.
    this.references.register({
      kind: "quest",
      order: 20,
      brokenKey: "folios.wikilink.broken.questNotFound",
      href: (projectSlug, ref) => `/${projectSlug}/quests/${ref.number}`,
      match: (path, projectSlug) =>
        WorkShell.matchPage(
          path,
          projectSlug,
          /^\/([^/]+)\/quests\/(\d+)(?:[#?]|$)/,
        ),
      preview: QuestReferencePreview,
      useReferences: useQuestReferences,
      useImageUpload: useQuestElementImageUpload,
    });
    this.references.register({
      kind: "epic",
      order: 30,
      brokenKey: "folios.wikilink.broken.epicNotFound",
      href: (projectSlug, ref) => `/${projectSlug}/epics/${ref.number}`,
      match: (path, projectSlug) =>
        WorkShell.matchPage(
          path,
          projectSlug,
          /^\/([^/]+)\/epics\/(\d+)(?:[#?]|$)/,
        ),
      preview: EpicReferencePreview,
      useReferences: useEpicReferences,
    });
    // Feedback has no page of its own, so `#P120` links to the inbox naming
    // the item.
    this.references.register({
      kind: "feedback",
      order: 40,
      brokenKey: "folios.wikilink.broken.feedbackNotFound",
      href: (projectSlug, ref) =>
        `/${projectSlug}/feedback?feedback=${ref.number}`,
      match: (path, projectSlug) =>
        WorkShell.matchPage(
          path,
          projectSlug,
          /^\/([^/]+)\/feedback\?feedback=(\d+)(?:[#&]|$)/,
        ),
      preview: FeedbackReferencePreview,
      useReferences: useFeedbackReferences,
    });
    // `#R12` resolves the number and navigates by the release's TAG, which
    // is what the page takes; a release with no tag links to the list.
    this.references.register({
      kind: "release",
      order: 50,
      brokenKey: "folios.wikilink.broken.releaseNotFound",
      href: (projectSlug, ref) =>
        ref.tag
          ? `/${projectSlug}/releases/${encodeURIComponent(ref.tag)}`
          : `/${projectSlug}/releases`,
      match: (path, projectSlug) => {
        const tag = WorkShell.matchPage(
          path,
          projectSlug,
          /^\/([^/]+)\/releases\/([^/?#]+)(?:[#?]|$)/,
        );
        return tag === undefined ? undefined : decodeURIComponent(tag);
      },
      preview: ReleaseReferencePreview,
      useReferences: useReleaseReferences,
    });

    this.prompts.register({
      kind: "epicReview",
      template: epicReviewPromptDefault,
      icon: ClipboardCheck,
      labelKey: "agentPrompts.review",
    });
    // `Wrench` and "Work on it", like the two below: handing an epic over is
    // the same verb as handing over a quest or a report, so it reads the
    // same on all three surfaces (feedback #P2182). Only the label and the
    // glyph: the kind stays `epicActivate`, because it is persisted in
    // `project_prompts.kind` and a rename would orphan every stored template.
    this.prompts.register({
      kind: "epicActivate",
      template: epicActivatePromptDefault,
      icon: Wrench,
      labelKey: "agentPrompts.workOnIt",
    });
    this.prompts.register({
      kind: "questWork",
      template: questWorkPromptDefault,
      icon: Wrench,
      labelKey: "agentPrompts.workOnIt",
    });
    this.prompts.register({
      kind: "feedbackWork",
      template: feedbackWorkPromptDefault,
      icon: Wrench,
      labelKey: "agentPrompts.workOnIt",
    });
    // ⚠️ Its own glyph and its own label, not `Wrench` and "Work on it". The
    // three above share those because they are the same verb on three
    // surfaces; this is a different verb on a surface none of them touches,
    // and a menu where every row is a wrench says nothing.
    this.prompts.register({
      kind: "feedbackLoop",
      template: feedbackLoopPromptDefault,
      icon: ListChecks,
      labelKey: "agentPrompts.triageInbox",
    });
    // `ListTodo`, not `Wrench`: "Work on it" hands over ONE item, and this
    // hands over a list. A wrench here would read as working the quest the
    // page happens to show.
    this.prompts.register({
      kind: "questLoop",
      template: questLoopPromptDefault,
      icon: ListTodo,
      labelKey: "agentPrompts.workLooseQuests",
    });
  }

  /**
   * The second capture of `pattern` when its first is this project's slug.
   * The project segment is matched as an opaque segment and compared, since
   * a slug cannot be told from any other first segment by shape alone.
   */
  protected static matchPage(
    path: string,
    projectSlug: string,
    pattern: RegExp,
  ): string | undefined {
    const match = pattern.exec(path);
    return match && match[1] === projectSlug ? match[2] : undefined;
  }
}
