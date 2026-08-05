import {
  AppShell,
  type NavGroup,
} from "@alepha/ui/components/app-shell/app-shell";
import { useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { NestedView, useRouter, useRouterState } from "alepha/react/router";
import {
  Activity,
  BarChart3,
  BookOpen,
  Bug,
  Cog,
  Flag,
  Grid3x2,
  Inbox,
  Server,
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
import type { I18n } from "../../services/I18n.ts";
import HeaderActions from "../shared/header/HeaderActions.tsx";
import ProjectActionsCreateButton from "./ProjectActionsCreateButton.tsx";
import ProjectSwitcher from "./ProjectSwitcher.tsx";
import QuestLog from "./QuestLog.tsx";

const ROUTES_WITH_QUEST_LOG = new Set(["projectQuests", "projectQuest"]);

const ROUTES_FULL_WIDTH = new Set([
  "projectFolios",
  "projectFoliosNew",
  "projectFoliosFolio",
  "projectFoliosFolioEdit",
  "projectFeedback",
  "projectBlights",
  "projectInsights",
  "projectOutposts",
  "projectQuestGraph",
]);

const SECTION_LABEL_KEYS: Record<string, string> = {
  projectQuests: "project.menu.quests",
  projectMilestones: "project.menu.milestones",
  projectReports: "project.menu.reports",
  projectFolios: "project.menu.folios",
  projectFoliosNew: "project.menu.folios",
  projectFoliosFolio: "project.menu.folios",
  projectFoliosFolioEdit: "project.menu.folios",
  projectFeedback: "project.menu.feedback",
  projectBlights: "project.menu.blights",
  projectInsights: "project.menu.insights",
  projectOutposts: "project.menu.outposts",
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
  // always on) → Ops (Insights / Outposts, both gated) → Settings (always
  // on). Groups with no items are dropped by the `.filter` below so an
  // all-gates-off project still renders a clean sidebar.
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

  const opsItems: NavGroup["items"] = [];
  if (features.beacon) {
    opsItems.push({
      label: tr("project.menu.insights"),
      icon: Activity,
      href: router.path("projectInsights", { params: { projectId } }),
      active: name === "projectInsights",
    });
  }
  if (features.outposts) {
    opsItems.push({
      label: tr("project.menu.outposts"),
      icon: Server,
      href: router.path("projectOutposts", { params: { projectId } }),
      active: name === "projectOutposts",
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
