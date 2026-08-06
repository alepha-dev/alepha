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
  Plus,
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
import ProjectSwitcher from "./ProjectSwitcher.tsx";
import QuestLog from "./QuestLog.tsx";

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
  projectSettingsZones: "project.menu.settings",
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
  if (features.blights) {
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
    const activeSigilId = ROUTES_APP.has(name)
      ? String(routerState.params.sigilId ?? "")
      : "";
    // Three states, and they are not the same thing. `undefined` means the
    // loader's `listSigils` failed and was swallowed to keep the page alive —
    // saying "Enrol an app" there would tell a member their project is empty
    // when it may be full. Both degenerate states still link to the settings
    // page, which is where a retry (or the enrolment form) lives.
    const appsUnavailable = sigils === undefined;
    const apps = sigils ?? [];
    const settingsHref = router.path("projectSettingsSigils", {
      params: { projectId },
    });
    opsItems.push({
      label: tr("project.menu.apps"),
      icon: AppWindow,
      // Rendered open in both degenerate states: a collapsed group holding the
      // only affordance — or the only explanation — is a dead end.
      defaultOpen: apps.length === 0 ? true : undefined,
      children: appsUnavailable
        ? [
            {
              label: tr("project.menu.apps.unavailable"),
              icon: TriangleAlert,
              href: settingsHref,
            },
          ]
        : apps.length === 0
          ? [
              {
                label: tr("project.menu.apps.enrol"),
                icon: Plus,
                href: settingsHref,
              },
            ]
          : apps.map((it) => ({
              label: it.name,
              href: router.path("app", {
                params: { projectId, sigilId: it.id },
              }),
              active: activeSigilId === it.id,
            })),
    });
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
        params: { projectId, sigilId: sigil.id },
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
      <div className="flex h-full flex-col">
        <div
          className={`flex min-h-0 flex-1 flex-col ${showQuestLog || fullWidth ? "overflow-hidden" : "overflow-auto"}`}
        >
          {showQuestLog ? (
            <div className="flex min-h-0 flex-1">
              <div
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
    </AppShell>
  );
};

export default ProjectView;
