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
  Layers,
  TriangleAlert,
} from "lucide-react";
import { useEffect } from "react";

import {
  defaultProjectFeatures,
  type ProjectFeatures,
} from "@/api/entities/projects.ts";

import type { AppRouter } from "../../AppRouter.ts";
import { currentBlightCountAtom } from "../../atoms/currentBlightCountAtom.ts";
import { currentEpicAtom } from "../../atoms/currentEpicAtom.ts";
import { currentEpicCountAtom } from "../../atoms/currentEpicCountAtom.ts";
import { currentFeedbackCountAtom } from "../../atoms/currentFeedbackCountAtom.ts";
import { currentFolioPathAtom } from "../../atoms/currentFolioPathAtom.ts";
import { currentProjectAtom } from "../../atoms/currentProjectAtom.ts";
import { currentQuestAtom } from "../../atoms/currentQuestAtom.ts";
import { currentQuestCountAtom } from "../../atoms/currentQuestCountAtom.ts";
import { currentSigilAtom } from "../../atoms/currentSigilAtom.ts";
import { currentSigilsAtom } from "../../atoms/currentSigilsAtom.ts";
import {
  type ProjectNavEntry,
  projectNavAtom,
} from "../../atoms/projectNavAtom.ts";
import { questLogCollapsedAtom } from "../../atoms/questLogCollapsedAtom.ts";
import { type QuestsView, questsViewAtom } from "../../atoms/questsViewAtom.ts";
import type { I18n } from "../../services/I18n.ts";
import HeaderActions from "../shared/header/HeaderActions.tsx";
import HeaderSearchButton from "../shared/header/HeaderSearchButton.tsx";
import ProjectActionsCreateButton from "./ProjectActionsCreateButton.tsx";
import ProjectQuestLogRail from "./ProjectQuestLogRail.tsx";
import ProjectQuestsViewSwitcher from "./ProjectQuestsViewSwitcher.tsx";
import ProjectSwitcher from "./ProjectSwitcher.tsx";
import QuestLog from "./QuestLog.tsx";

/**
 * The quest list AND the quest detail. The log is how you move between
 * quests without going back to the list first, which is exactly what the
 * detail route wants; the collapse rail is what keeps it from costing the
 * quest its width when a reader does not want it.
 *
 * This set also drives the view bar, so both routes get it. Dropping it on
 * the detail route would shift the log up the moment a quest opened - which
 * is why, on that route, the bar navigates instead of switching in place.
 */
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
  "appSettings",
]);

const ROUTES_FULL_WIDTH = new Set([
  "projectQuest",
  "projectEpics",
  "projectEpic",
  "projectMilestones",
  "projectFolios",
  "projectFoliosNew",
  "projectFoliosFolio",
  "projectFeedback",
  "projectBlights",
  "projectQuestGraph",
  ...ROUTES_APP,
]);

/**
 * The list route a section's breadcrumb crumb climbs back to, keyed by the
 * route currently open. A section whose crumb has no entry here renders as
 * plain text, which is why "Epics" used to be a dead label on an epic page.
 *
 * The three folio routes all map to the folio root, and `projectFolios` maps
 * to itself on purpose: a deep directory is that same route carrying a `?dir=`
 * query, so treating it as "the page you are already on" and dropping the link
 * would strand the user inside the tree, the opposite of what the link is for.
 *
 * `projectEpics` is deliberately absent for the mirror-image reason: the epic
 * list has no such nested state, so on the list itself the crumb is the open
 * page and should stay inert.
 *
 * Apps have no entry because they have no list route at all: `/apps/:appName`
 * is the only way to address one, and the inventory lives under Settings.
 */
const SECTION_HREF_ROUTES: Record<
  string,
  "projectFolios" | "projectEpics" | "projectQuests"
> = {
  projectFolios: "projectFolios",
  projectFoliosNew: "projectFolios",
  projectFoliosFolio: "projectFolios",
  projectEpic: "projectEpics",
  projectQuest: "projectQuests",
};

const SECTION_LABEL_KEYS: Record<string, string> = {
  projectQuests: "project.menu.quests",
  projectQuest: "project.menu.quests",
  projectEpics: "project.menu.epics",
  projectEpic: "project.menu.epics",
  projectMilestones: "project.menu.milestones",
  projectReports: "project.menu.reports",
  reportsOverview: "project.menu.reports",
  reportsQuests: "project.menu.reports",
  reportsMembers: "project.menu.reports",
  projectFolios: "project.menu.folios",
  projectFoliosNew: "project.menu.folios",
  projectFoliosFolio: "project.menu.folios",
  projectFeedback: "project.menu.feedback",
  projectBlights: "project.menu.blights",
  projectApp: "project.menu.apps",
  app: "project.menu.apps",
  appAnalytics: "project.menu.apps",
  appPerformance: "project.menu.apps",
  appSettings: "project.menu.apps",
  projectSettings: "project.menu.settings",
  projectSettingsBanner: "project.menu.settings",
  projectSettingsAreas: "project.menu.settings",
  projectSettingsKanban: "project.menu.settings",
  projectSettingsFolios: "project.menu.settings",
  projectSettingsMilestones: "project.menu.settings",
  projectSettingsMembers: "project.menu.settings",
  projectSettingsFeedback: "project.menu.settings",
  projectSettingsSigils: "project.menu.settings",
  projectSettingsQuests: "project.menu.settings",
};

const ProjectView = () => {
  const routerState = useRouterState();
  const router = useRouter<AppRouter>();
  const { tr } = useI18n<I18n, "en">();
  const name = routerState.name ?? "";
  const [questsView, setQuestsView] = useStore(questsViewAtom);
  const [questLogCollapsed, setQuestLogCollapsed] = useStore(
    questLogCollapsedAtom,
  );
  // Kanban is not its own route anymore (the great rename, Task 8) — the
  // board needs the same full-width, no quest-log treatment its old
  // dedicated route got, so branch on the stored view in addition to the
  // route name. That view was a `?view=kanban` query param until #156;
  // reading it from an atom is what lets this component see it at all
  // without the page having to publish it into the URL first.
  const kanbanView = name === "projectQuests" && questsView.view === "kanban";
  const showQuestLog = ROUTES_WITH_QUEST_LOG.has(name) && !kanbanView;
  const fullWidth = ROUTES_FULL_WIDTH.has(name) || kanbanView;
  // Both routes, for the same reason the quest log gets both: dropping the
  // bar on the detail route would shift the log up by the bar's height the
  // moment a quest opened. What it does there is not switch the page - the
  // detail route has no two views - but go back up to the one that does; see
  // `selectView`.
  const showViewBar = ROUTES_WITH_QUEST_LOG.has(name);

  const [project] = useStore(currentProjectAtom);
  const [questCount] = useStore(currentQuestCountAtom);
  const [feedbackCount] = useStore(currentFeedbackCountAtom);
  const [blightCount] = useStore(currentBlightCountAtom);
  const [folioPath] = useStore(currentFolioPathAtom);
  const [sigils] = useStore(currentSigilsAtom);
  const [sigil] = useStore(currentSigilAtom);
  const [epic] = useStore(currentEpicAtom);
  const [quest] = useStore(currentQuestAtom);
  const [epicCount] = useStore(currentEpicCountAtom);

  if (!project) {
    return null;
  }

  const projectSlug = project.slug;

  const features: ProjectFeatures = {
    ...defaultProjectFeatures,
    ...project.features,
  };

  // The view is state, not a destination, so picking one is a plain write —
  // no navigation, no history entry, and nothing for a later render to undo.
  //
  // Except from the quest DETAIL route, which renders the bar (to keep the
  // quest log from jumping) but has no list and no board of its own. The
  // write alone left the pressed entry moving and the page not: a control
  // that answers a click by doing nothing visible. So going up to the page
  // the chosen view belongs to is the second half of picking one there.
  const selectView = (view: QuestsView) => {
    setQuestsView({ view });
    if (name === "projectQuest") {
      void router.push("projectQuests", { params: { projectSlug } });
    }
  };

  // Four unlabelled groups (`NavGroup.label` omitted on purpose, see the great
  // rename Task 9), split by whether you ACT on a surface or READ it:
  //
  //   Work      Quests, Epics, Feedback, Blights
  //   Record    Folios, Milestones, Reports
  //   Ops       Apps
  //   Settings
  //
  // Work is ordered chosen-then-arrived: Quests and Epics are what you put in,
  // Feedback and Blights turn up on their own and need a verdict. They share
  // one group rather than two, so the separator falls only where the mode
  // changes from acting to reading.
  //
  // Milestones sits in Record, not beside Quests, because it plans nothing:
  // the entity carries no objective or target, membership is a time window
  // (`completedAt > last.closedAt`) rather than an assignment, no quest
  // surface can even set `milestoneId`, and it auto-closes on a cron into a
  // rich-markdown `changelog`. It is a folio the app fills in for you.
  //
  // Groups with no items are dropped by the `.filter` below, so an
  // all-gates-off project still renders a clean sidebar.
  const workItems: NavGroup["items"] = [
    {
      label: tr("project.menu.quests"),
      icon: Grid3x2,
      href: router.path("projectQuests", { params: { projectSlug } }),
      // Highlighted from anywhere under Quests, not just the list: opening a
      // quest used to clear the sidebar entirely, so the one page you were
      // deepest inside was the one page that said where you were not. Epics
      // already did this for `projectEpic`, and the breadcrumb has always
      // treated these as the Quests section (see `SECTION_LABEL_KEYS`).
      active:
        name === "projectQuests" ||
        name === "project" ||
        name === "projectQuest" ||
        name === "projectQuestGraph",
      badge: questCount?.count ? questCount.count : undefined,
    },
  ];
  // A lens on quests, so it sits right after them: scope, then the items.
  if (features.epics) {
    workItems.push({
      label: tr("project.menu.epics"),
      icon: Layers,
      href: router.path("projectEpics", { params: { projectSlug } }),
      active: name === "projectEpics" || name === "projectEpic",
      // Planned epics only, and hidden at zero like every other badge here.
      // A planned epic is a gate holding its quests out of the Quests count
      // beside it, so this is the sidebar's only trace of that work.
      badge: epicCount?.count ? epicCount.count : undefined,
    });
  }
  // Arrived rather than chosen. Feedback leads because a human wrote it; a
  // blight is filed by a machine.
  if (features.feedback) {
    workItems.push({
      label: tr("project.menu.feedback"),
      icon: Inbox,
      href: router.path("projectFeedback", { params: { projectSlug } }),
      active: name === "projectFeedback",
      badge: feedbackCount?.count ? feedbackCount.count : undefined,
    });
  }
  // Blights are reported by apps, so the entry appears once some enrolled app
  // carries the capability, and goes when the last one drops it. `?? []` means
  // a failed sigil read hides the entry, the same "a degraded section costs a
  // section" trade the Apps group below makes.
  //
  // ...unless blights are already filed. They outlive the app that reported
  // them (`blights.sigilId` is `ON DELETE SET NULL`) and stay for the
  // retention window, so an owner who deletes their only app, or switches
  // Blights off on it, would otherwise lose the only way into an inbox that
  // still holds open crashes. A project that has never collected one still
  // shows no entry, which is the property this gate exists for.
  const collectsBlights = (sigils ?? []).some((it) =>
    it.kinds.includes("blights"),
  );
  const hasOpenBlights = (blightCount?.count ?? 0) > 0;
  if (features.sigils && (collectsBlights || hasOpenBlights)) {
    workItems.push({
      label: tr("project.menu.blights"),
      icon: Bug,
      href: router.path("projectBlights", { params: { projectSlug } }),
      active: name === "projectBlights",
      badge: blightCount?.count ? blightCount.count : undefined,
    });
  }

  // Record: surfaces you consult. Hand-written first, then the two the app
  // writes for you.
  const recordItems: NavGroup["items"] = [];
  if (features.folios) {
    recordItems.push({
      label: tr("project.menu.folios"),
      icon: BookOpen,
      href: router.path("projectFolios", { params: { projectSlug } }),
      active: name.startsWith("projectFolios"),
    });
  }
  if (features.milestones) {
    recordItems.push({
      label: tr("project.menu.milestones"),
      icon: Flag,
      href: router.path("projectMilestones", { params: { projectSlug } }),
      active: name === "projectMilestones",
    });
  }
  recordItems.push({
    label: tr("project.menu.reports"),
    icon: BarChart3,
    href: router.path("projectReports", { params: { projectSlug } }),
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
                  params: { projectSlug },
                }),
              },
            ]
          : apps.map((it) => ({
              label: it.name,
              href: router.path("app", {
                params: { projectSlug, appName: it.name },
              }),
              active: activeAppName === it.name,
            })),
      });
    }
  }

  const nav: NavGroup[] = [
    { items: workItems },
    { items: recordItems },
    { items: opsItems },
    {
      items: [
        {
          label: tr("project.menu.settings"),
          icon: Cog,
          href: router.path("projectSettingsBanner", {
            params: { projectSlug },
          }),
          active: name.startsWith("projectSettings"),
        },
      ],
    },
  ].filter((group) => group.items.length > 0);

  // Publish what the sidebar offers so the ⌘K palette can list pages and apps
  // beside its content hits — see `projectNavAtom` for why it is derived from
  // the built `nav` rather than assembled a second time.
  //
  // Flattened here rather than in the palette so the palette never has to know
  // the sidebar's shape: `children` is what makes an entry a group (today only
  // Apps), and a group's own row is a disclosure with no destination of its
  // own, so it contributes its children and not itself.
  const navPages: ProjectNavEntry[] = nav.flatMap((group) =>
    group.items.flatMap((item): ProjectNavEntry[] => {
      if (item.children?.length) {
        return item.children
          .filter((child) => !!child.href)
          .map((child) => ({
            // Coercion at a boundary: the value is a form/route/chart primitive whose
            // declared type is wider than what can reach here.
            // oxlint-disable-next-line typescript/no-base-to-string
            label: String(child.label),
            href: String(child.href),
            kind: "app",
          }));
      }
      if (!item.href) return [];
      return [
        // Coercion at a boundary: the value is a form/route/chart primitive whose
        // declared type is wider than what can reach here.
        // oxlint-disable-next-line typescript/no-base-to-string
        { label: String(item.label), href: String(item.href), kind: "page" },
      ];
    }),
  );
  const [, setProjectNav] = useStore(projectNavAtom);
  // Keyed on the CONTENT, not the array: `navPages` is rebuilt on every render,
  // so an effect depending on its identity would set the atom, re-render, and
  // loop. Cleared on leave like the other `current*` atoms — a stale page list
  // would otherwise offer another project's apps.
  const navSignature = JSON.stringify(navPages);
  useEffect(() => {
    setProjectNav(navPages);
    return () => setProjectNav(undefined);
  }, [navSignature, setProjectNav]);

  const breadcrumbs: { label: string; href?: string }[] = [
    {
      label: project.title,
      href: router.path("project", { params: { projectSlug } }),
    },
  ];
  // Kanban is a view of `projectQuests`, not its own section anymore
  // (Task 8) — the breadcrumb reads "Quests" whichever view is active,
  // same as the sidebar's single Quests entry.
  const sectionKey = SECTION_LABEL_KEYS[name];
  if (sectionKey) {
    const sectionRoute = SECTION_HREF_ROUTES[name];
    const sectionHref = sectionRoute
      ? router.path(sectionRoute, { params: { projectSlug } })
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
        params: { projectSlug, appName: sigil.name },
      }),
    });
  }
  // The epic detail page contributes the epic's own `#number` as a leaf, so
  // the header reads "Project › Epics › #2". No `href`: the leaf is the page
  // already open.
  //
  // The number, not the title, for the reason the quest leaf below gives and
  // one more: the title now heads `ProjectEpicAside`, immediately under this
  // bar, so a crumb repeating it would put the same words twice on screen a
  // few pixels apart. The identifier and the name are split across the two,
  // one each.
  if (name === "projectEpic" && epic) {
    breadcrumbs.push({ label: `#${epic.number}` });
  }
  // Same shape for the quest detail page: `#1208` as an inert leaf. The
  // number, not the title — the title is already the first thing on the page,
  // and a long one would push the crumbs off the bar.
  if (name === "projectQuest" && quest) {
    breadcrumbs.push({ label: `#${quest.shortId}` });
  }
  // Folio routes contribute their directory chain (and the folio
  // title leaf) via `currentFolioPathAtom`, written by the folio loaders.
  if (name.startsWith("projectFolios") && folioPath.length > 0) {
    for (const segment of folioPath) {
      breadcrumbs.push({
        label: segment.name,
        href:
          segment.shortId !== undefined
            ? `${router.path("projectFolios", { params: { projectSlug } })}?dir=${segment.shortId}`
            : undefined,
      });
    }
  }

  return (
    <AppShell
      embedded
      fill
      variant="inset"
      // The page surface. Defined in `main.css` rather than inline because
      // it needs a `.dark` variant: the mockup's dot is near-white, which is
      // invisible over a light page.
      mainClassName="lore-page-dots"
      brand={<ProjectSwitcher />}
      nav={nav}
      breadcrumbs={breadcrumbs}
      topbarActions={
        <>
          <ProjectActionsCreateButton />
          {/* Through `before`, not as a sibling: that puts the magnifier in
              the cluster's own flex row, so it takes the same gap as the four
              icons it now sits with rather than the topbar's spacing. */}
          <HeaderActions before={<HeaderSearchButton />} />
        </>
      }
    >
      {/* The view bar is the FIRST child of the content area — outside the
          three-way branch below, so it holds the same position whether the
          branch renders the quest log, the full-width board, or the centered
          column. Anything rendered from inside a branch necessarily sits to
          the right of the quest log, which is what this replaces. It was a
          vertical rail down the left edge until #163; as a top bar the same
          invariant holds on the y-axis instead. */}
      <div className="flex h-full flex-col">
        {showViewBar && (
          <ProjectQuestsViewSwitcher
            // The stored preference, not `kanbanView` — on the quest DETAIL
            // route the layout is never the board, but the bar still stands
            // for which view the list will come back as.
            view={questsView.view}
            kanbanEnabled={features.kanban === true}
            onSelect={selectView}
          />
        )}
        <div className="flex min-h-0 w-full min-w-0 flex-1 flex-col">
          <div
            className={`flex min-h-0 flex-1 flex-col ${showQuestLog || fullWidth ? "overflow-hidden" : "overflow-auto"}`}
          >
            {showQuestLog ? (
              <div className="flex min-h-0 flex-1">
                {/* Collapsed, the pane becomes a rail — but BOTH carry the same
                    `hidden lg:flex` gate. Below `lg` the quest log does not
                    render at all today, so a rail without that gate would
                    introduce 32px of chrome on mobile where there is currently
                    nothing, and a control that expands a pane the viewport
                    then refuses to show. */}
                {questLogCollapsed.collapsed ? (
                  <div className="hidden min-h-0 lg:flex">
                    <ProjectQuestLogRail
                      onExpand={() =>
                        setQuestLogCollapsed({ collapsed: false })
                      }
                    />
                  </div>
                ) : (
                  <div
                    data-testid="quest-log"
                    className="border-border hidden min-h-0 shrink-0 border-r lg:flex"
                    style={{ width: "25%", minWidth: 240, maxWidth: 420 }}
                  >
                    <QuestLog
                      onCollapse={() =>
                        setQuestLogCollapsed({ collapsed: true })
                      }
                    />
                  </div>
                )}
                {/* The list owns its own scroll, so this wrapper must NOT
                  also scroll — a nested `overflow-auto` here showed a spurious
                  scrollbar.

                  `p-2` for the list, which has no padding of its own, and
                  none for the quest detail, which carries the mockup's own
                  28/40/56 and whose sticky header spans the full width by
                  cancelling it with a negative margin. Padding here would
                  inset that header and leave a gutter down both sides of a
                  page designed to be flush. */}
                <div
                  className={`flex min-h-0 flex-1 flex-col overflow-hidden ${
                    fullWidth ? "" : "p-2"
                  }`}
                >
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
