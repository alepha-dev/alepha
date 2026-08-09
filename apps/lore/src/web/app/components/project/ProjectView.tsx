import {
  AppShell,
  type NavGroup,
} from "@alepha/ui/components/app-shell/app-shell";
import { useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { NestedView, useRouter, useRouterState } from "alepha/react/router";
import {
  AppWindow,
  BarChart3,
  BookOpen,
  Bug,
  Cog,
  Flag,
  Grid3x2,
  Inbox,
  TriangleAlert,
} from "lucide-react";
import {
  defaultProjectFeatures,
  type ProjectFeatures,
} from "@/api/entities/projects.ts";
import type { AppRouter } from "../../AppRouter.ts";
import { currentBlightCountAtom } from "../../atoms/currentBlightCountAtom.ts";
import { currentFeedbackCountAtom } from "../../atoms/currentFeedbackCountAtom.ts";
import { currentFolioPathAtom } from "../../atoms/currentFolioPathAtom.ts";
import { currentProjectAtom } from "../../atoms/currentProjectAtom.ts";
import { currentQuestCountAtom } from "../../atoms/currentQuestCountAtom.ts";
import { currentSigilAtom } from "../../atoms/currentSigilAtom.ts";
import { currentSigilsAtom } from "../../atoms/currentSigilsAtom.ts";
import type { I18n } from "../../services/I18n.ts";
import HeaderActions from "../shared/header/HeaderActions.tsx";
import ProjectActionsCreateButton from "./ProjectActionsCreateButton.tsx";
import ProjectQuestsViewSwitcher from "./ProjectQuestsViewSwitcher.tsx";
import ProjectSwitcher from "./ProjectSwitcher.tsx";
import QuestLog from "./QuestLog.tsx";
import { type QuestsView, writeStoredQuestsView } from "./questsView.ts";

const ROUTES_WITH_QUEST_LOG = new Set(["projectQuests", "projectQuest"]);

/**
 * The per-app page and its tabs.
 *
 * A plain string set, because route names are plain strings here with nothing
 * in the type system tying them to the route table — renaming one of these
 * `$page`s without editing this set is not a compile error, it is a sidebar
 * that silently stops highlighting.
 */
const ROUTES_APP = new Set([
  "projectApp",
  "app",
  "appAnalytics",
  "appPerformance",
  "appErrors",
  "appSettings",
]);

const ROUTES_FULL_WIDTH = new Set([
  "projectMilestones",
  "projectFolios",
  "projectFoliosNew",
  "projectFoliosFolio",
  "projectFeedback",
  "projectBlights",
  "projectQuestGraph",
  ...ROUTES_APP,
]);

const SECTION_LABEL_KEYS: Record<string, string> = {
  projectQuests: "project.menu.quests",
  projectMilestones: "project.menu.milestones",
  projectReports: "project.menu.reports",
  projectFolios: "project.menu.folios",
  projectFoliosNew: "project.menu.folios",
  projectFoliosFolio: "project.menu.folios",
  projectFeedback: "project.menu.feedback",
  projectBlights: "project.menu.blights",
  projectApp: "project.menu.apps",
  app: "project.menu.apps",
  appAnalytics: "project.menu.apps",
  appPerformance: "project.menu.apps",
  appErrors: "project.menu.apps",
  appSettings: "project.menu.apps",
  projectSettings: "project.menu.settings",
  projectSettingsBanner: "project.menu.settings",
  projectSettingsAreas: "project.menu.settings",
  projectSettingsKanban: "project.menu.settings",
  projectSettingsFolios: "project.menu.settings",
  projectSettingsMilestones: "project.menu.settings",
};

const ProjectView = () => {
  const routerState = useRouterState();
  const router = useRouter<AppRouter>();
  const { tr } = useI18n<I18n, "en">();
  const name = routerState.name ?? "";
  // Kanban is a `?view=kanban` toggle on `projectQuests`, not its own route
  // anymore (the great rename, Task 8) — the board needs the same
  // full-width, no quest-log treatment its old dedicated route got, so
  // branch on the query in addition to the route name.
  const kanbanView =
    name === "projectQuests" && routerState.query.view === "kanban";
  const showQuestLog = ROUTES_WITH_QUEST_LOG.has(name) && !kanbanView;
  const fullWidth = ROUTES_FULL_WIDTH.has(name) || kanbanView;
  // The view rail belongs to the whole quests surface, so it renders on the
  // same routes as the quest log — including the quest DETAIL route, where
  // the log is also shown. Dropping it there would slide the log (and every
  // pixel right of it) left by the rail's width the moment a quest opens,
  // which is exactly the jump hoisting the rail out of the content area was
  // meant to remove. From detail, picking a view navigates back to the list.
  const showViewRail = ROUTES_WITH_QUEST_LOG.has(name);

  const [project] = useStore(currentProjectAtom);
  const [questCount] = useStore(currentQuestCountAtom);
  const [feedbackCount] = useStore(currentFeedbackCountAtom);
  const [blightCount] = useStore(currentBlightCountAtom);
  const [folioPath] = useStore(currentFolioPathAtom);
  const [sigils] = useStore(currentSigilsAtom);
  const [sigil] = useStore(currentSigilAtom);

  if (!project) {
    return null;
  }

  const projectId = String(project.id);

  const features: ProjectFeatures = {
    ...defaultProjectFeatures,
    ...project.features,
  };

  // Writes `?view=list` explicitly rather than clearing the param: the stored
  // preference only SEEDS a bare `/p/:id/`, so an explicit choice has to win
  // over it — clearing would let the seed put the board straight back. Also
  // navigates by name, so picking a view from the quest DETAIL route lands on
  // the list rather than trying to apply a view to a quest page.
  const selectView = (view: QuestsView) => {
    writeStoredQuestsView(view);
    router.push("projectQuests", { params: { projectId }, query: { view } });
  };

  // Four unlabelled groups (`NavGroup.label` omitted on purpose — see the
  // great rename Task 9). Order is fixed: Work (Quests always on, Blights /
  // Feedback / Milestones feature-gated) → Memory (Folios gated, Reports
  // always on) → Ops (Apps, gated on `sigils`) → Settings (always on). Groups
  // with no items are dropped by the `.filter` below so an all-gates-off
  // project still renders a clean sidebar.
  const workItems: NavGroup["items"] = [
    {
      label: tr("project.menu.quests"),
      icon: Grid3x2,
      href: router.path("projectQuests", { params: { projectId } }),
      active: name === "projectQuests" || name === "project",
      badge: questCount?.count ? questCount.count : undefined,
    },
  ];
  // Blights are reported by apps, so the entry follows the apps: it appears
  // once some enrolled app carries the capability, and goes when the last one
  // drops it. `?? []` means a failed sigil read hides the entry — the same
  // "a degraded section costs a section" trade the Apps group below makes.
  //
  // …unless blights are already filed. They outlive the app that reported them
  // (`blights.sigilId` is `ON DELETE SET NULL`) and stay for the retention
  // window, so an owner who deletes their only app — or switches Blights off
  // on it — would otherwise lose the only way into an inbox that still holds
  // open crashes. A project that has never collected one still shows no entry,
  // which is the property this gate exists for.
  const collectsBlights = (sigils ?? []).some((it) =>
    it.kinds.includes("blights"),
  );
  const hasOpenBlights = (blightCount?.count ?? 0) > 0;
  if (features.sigils && (collectsBlights || hasOpenBlights)) {
    workItems.push({
      label: tr("project.menu.blights"),
      icon: Bug,
      href: router.path("projectBlights", { params: { projectId } }),
      active: name === "projectBlights",
      badge: blightCount?.count ? blightCount.count : undefined,
    });
  }
  if (features.feedback) {
    workItems.push({
      label: tr("project.menu.feedback"),
      icon: Inbox,
      href: router.path("projectFeedback", { params: { projectId } }),
      active: name === "projectFeedback",
      badge: feedbackCount?.count ? feedbackCount.count : undefined,
    });
  }
  if (features.milestones) {
    workItems.push({
      label: tr("project.menu.milestones"),
      icon: Flag,
      href: router.path("projectMilestones", { params: { projectId } }),
      active: name === "projectMilestones",
    });
  }

  const knowledgeItems: NavGroup["items"] = [];
  if (features.folios) {
    knowledgeItems.push({
      label: tr("project.menu.folios"),
      icon: BookOpen,
      href: router.path("projectFolios", { params: { projectId } }),
      active: name.startsWith("projectFolios"),
    });
  }
  knowledgeItems.push({
    label: tr("project.menu.reports"),
    icon: BarChart3,
    href: router.path("projectReports", { params: { projectId } }),
    active: name === "projectReports" || name.startsWith("reports"),
  });

  // Apps — one collapsible entry per enrolled app. `NavItem.children` is what
  // makes the parent a group; the shell opens it on its own whenever one of its
  // descendants is active, so being inside an app reveals the list without any
  // persisted open/closed state of our own.
  //
  // Names only, no badges: an app with three errors and one with three hundred
  // would read the same at a glance, and the number that matters is per-tab.
  const opsItems: NavGroup["items"] = [];
  if (features.sigils) {
    const activeAppName = ROUTES_APP.has(name)
      ? String(routerState.params.appName ?? "")
      : "";
    // Two states worth rendering, and they are not the same claim. `undefined`
    // means the loader's `listSigils` failed and was swallowed to keep the page
    // alive — that is worth saying, and it links to the settings page where a
    // retry lives. `[]` renders nothing at all: the group would hold no apps
    // and no way to add one, since enrolment lives on the settings page.
    const appsUnavailable = sigils === undefined;
    const apps = sigils ?? [];
    if (appsUnavailable || apps.length > 0) {
      opsItems.push({
        label: tr("project.menu.apps"),
        icon: AppWindow,
        // Open by default while the list is short enough to read at a glance,
        // and once past that left to the shell — `undefined` means "closed
        // unless a descendant is active".
        defaultOpen: apps.length > 5 ? undefined : true,
        children: appsUnavailable
          ? [
              {
                label: tr("project.menu.apps.unavailable"),
                icon: TriangleAlert,
                href: router.path("projectSettingsSigils", {
                  params: { projectId },
                }),
              },
            ]
          : apps.map((it) => ({
              label: it.name,
              href: router.path("app", {
                params: { projectId, appName: it.name },
              }),
              active: activeAppName === it.name,
            })),
      });
    }
  }

  const nav: NavGroup[] = [
    { items: workItems },
    { items: knowledgeItems },
    { items: opsItems },
    {
      items: [
        {
          label: tr("project.menu.settings"),
          icon: Cog,
          href: router.path("projectSettingsBanner", { params: { projectId } }),
          active: name.startsWith("projectSettings"),
        },
      ],
    },
  ].filter((group) => group.items.length > 0);

  const breadcrumbs: { label: string; href?: string }[] = [
    {
      label: project.title,
      href: router.path("project", { params: { projectId } }),
    },
  ];
  // Kanban is a `?view=kanban` toggle on `projectQuests`, not its own
  // section anymore (Task 8) — the breadcrumb reads "Quests" whichever
  // view is active, same as the sidebar's single Quests entry.
  const sectionKey = SECTION_LABEL_KEYS[name];
  if (sectionKey) {
    // For folio routes, the "Folios" section label links back to
    // the folio root so the user can climb out of a deep folio with
    // one click.
    const sectionHref = name.startsWith("projectFolios")
      ? router.path("projectFolios", { params: { projectId } })
      : undefined;
    breadcrumbs.push({
      label: tr(sectionKey as never),
      href: sectionHref,
    });
  }
  // The app pages contribute the app's own name as a leaf, so the header reads
  // "Project › Apps › checkout" rather than stopping at the section.
  if (ROUTES_APP.has(name) && sigil) {
    breadcrumbs.push({
      label: sigil.name,
      href: router.path("app", {
        params: { projectId, appName: sigil.name },
      }),
    });
  }
  // Folio routes contribute their directory chain (and the folio
  // title leaf) via `currentFolioPathAtom` — written by
  // FolioBrowser on every refresh and by the folio loader on view.
  if (name.startsWith("projectFolios") && folioPath.length > 0) {
    for (const segment of folioPath) {
      breadcrumbs.push({
        label: segment.name,
        href:
          segment.shortId !== undefined
            ? `${router.path("projectFolios", { params: { projectId } })}?dir=${segment.shortId}`
            : undefined,
      });
    }
  }

  return (
    <AppShell
      embedded
      fill
      variant="inset"
      brand={<ProjectSwitcher />}
      nav={nav}
      breadcrumbs={breadcrumbs}
      topbarActions={
        <>
          <ProjectActionsCreateButton />
          <HeaderActions />
        </>
      }
    >
      {/* The rail is the FIRST child of the content area — outside the
          three-way branch below, so it holds the same x-position whether the
          branch renders the quest log, the full-width board, or the centered
          column. Anything rendered from inside a branch necessarily sits to
          the right of the quest log, which is what this replaces. */}
      <div className="flex h-full">
        {showViewRail && (
          <ProjectQuestsViewSwitcher
            view={kanbanView ? "kanban" : "list"}
            kanbanEnabled={features.kanban === true}
            onSelect={selectView}
          />
        )}
        <div className="flex h-full min-w-0 flex-1 flex-col">
          <div
            className={`flex min-h-0 flex-1 flex-col ${showQuestLog || fullWidth ? "overflow-hidden" : "overflow-auto"}`}
          >
            {showQuestLog ? (
              <div className="flex min-h-0 flex-1">
                <div
                  data-testid="quest-log"
                  className="border-border hidden min-h-0 shrink-0 border-r lg:flex"
                  style={{ width: "25%", minWidth: 240, maxWidth: 420 }}
                >
                  <QuestLog />
                </div>
                {/* QuestView owns its own scroll (`overflow-y-auto` on its
                  body), so this wrapper must NOT also scroll — a nested
                  `overflow-auto` here showed a spurious scrollbar even on
                  short quests. Matches the `fullWidth` branch's no-scroll
                  intent. */}
                <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-2">
                  <NestedView />
                </div>
              </div>
            ) : fullWidth ? (
              <div className="flex min-h-0 w-full flex-1 flex-col">
                <NestedView />
              </div>
            ) : (
              <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col p-2">
                <NestedView />
              </div>
            )}
          </div>
        </div>
      </div>
    </AppShell>
  );
};

export default ProjectView;
