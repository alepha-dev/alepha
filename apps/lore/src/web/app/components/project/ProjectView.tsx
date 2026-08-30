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
  Columns3,
  Flag,
  Grid3x2,
  Inbox,
  Layers,
  TriangleAlert,
} from "lucide-react";

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
import { questLogCollapsedAtom } from "../../atoms/questLogCollapsedAtom.ts";
import type { I18n } from "../../services/I18n.ts";
import HeaderActions from "../shared/header/HeaderActions.tsx";
import HeaderSearchButton from "../shared/header/HeaderSearchButton.tsx";
import ProjectActionsCreateButton from "./ProjectActionsCreateButton.tsx";
import ProjectQuestLogRail from "./ProjectQuestLogRail.tsx";
import ProjectSwitcher from "./ProjectSwitcher.tsx";
import ProjectViewNavPublisher from "./ProjectViewNavPublisher.tsx";
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
  "projectApps",
  "appAnalytics",
  "appAnalyticsDimension",
  "appVitals",
  "appSettings",
]);

const ROUTES_FULL_WIDTH = new Set([
  "projectQuest",
  "projectKanban",
  "projectEpics",
  "projectEpic",
  "projectReleases",
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
 * Apps now have one, `projectApps`, which is why the "Apps" crumb on an app
 * page is a link rather than the dead text it used to render as. The list has
 * no sidebar entry on purpose - the sidebar already carries a disclosure group
 * with one child per app - so this crumb is its only door.
 */
const SECTION_HREF_ROUTES: Record<
  string,
  "projectFolios" | "projectEpics" | "projectQuests" | "projectApps"
> = {
  projectFolios: "projectFolios",
  projectFoliosNew: "projectFolios",
  projectFoliosFolio: "projectFolios",
  projectEpic: "projectEpics",
  projectQuest: "projectQuests",
  projectApp: "projectApps",
  app: "projectApps",
  appAnalytics: "projectApps",
  appAnalyticsDimension: "projectApps",
  appVitals: "projectApps",
  appSettings: "projectApps",
};

const SECTION_LABEL_KEYS: Record<string, string> = {
  projectQuests: "project.menu.quests",
  projectQuest: "project.menu.quests",
  projectKanban: "project.menu.kanban",
  projectEpics: "project.menu.epics",
  projectEpic: "project.menu.epics",
  projectReleases: "project.menu.releases",
  projectReports: "project.menu.reports",
  reportsOverview: "project.menu.reports",
  reportsQuests: "project.menu.reports",
  reportsMembers: "project.menu.reports",
  projectFolios: "project.menu.folios",
  projectFoliosNew: "project.menu.folios",
  projectFoliosFolio: "project.menu.folios",
  projectFeedback: "project.menu.feedback",
  projectBlights: "project.menu.blights",
  projectApps: "project.menu.apps",
  projectApp: "project.menu.apps",
  app: "project.menu.apps",
  appAnalytics: "project.menu.apps",
  appAnalyticsDimension: "project.menu.apps",
  appVitals: "project.menu.apps",
  appSettings: "project.menu.apps",
  projectSettings: "project.menu.settings",
  projectSettingsBanner: "project.menu.settings",
  projectSettingsAreas: "project.menu.settings",
  projectSettingsKanban: "project.menu.settings",
  projectSettingsFolios: "project.menu.settings",
  projectSettingsReleases: "project.menu.settings",
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
  const [questLogCollapsed, setQuestLogCollapsed] = useStore(
    questLogCollapsedAtom,
  );
  const showQuestLog = ROUTES_WITH_QUEST_LOG.has(name);
  const fullWidth = ROUTES_FULL_WIDTH.has(name);

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

  // Four unlabelled groups (`NavGroup.label` omitted on purpose, see the great
  // rename Task 9):
  //
  //   Work      Quests, Kanban, Epics, Feedback, Blights
  //   Record    Folios, Releases, Reports
  //   Ops       Apps
  //   Settings
  //
  // Work is ordered chosen-then-arrived: Quests and Epics are what you put in,
  // Feedback and Blights turn up on their own and need a verdict. They share
  // one group rather than two, so the separator falls only where the mode
  // changes.
  //
  // ⚠️ The split is NOT "act versus read", whatever earlier comments here
  // said. It is **the work, versus the record of it**. The old wording never
  // survived contact with Folios, which sits in Record and is the most
  // written-to surface in the app: always-editable and auto-saved. A group
  // containing that cannot be the read-only one.
  //
  // Releases moved back to Record on 2026-08-30, at the owner's request, and
  // this is the SECOND time this entry has moved, so both trips are written
  // down rather than left for a third.
  //
  // It sat in Record originally because the entity was thin: no objective or
  // target, membership a TIME WINDOW rather than an assignment, no quest
  // surface able to set `releaseId`, and a cron that auto-closed it into a
  // rich-markdown changelog. It was a folio the app filled in for you.
  //
  // Epic #14 falsified every clause of that, which is why it moved to Work.
  // What that argument got wrong was the axis, not the facts: it showed a
  // release is something you ACT on, and then treated Record as the place for
  // things you do not. Under the real split a release is a record - the named
  // thing you publish, freeze and keep - and attaching an epic to one is a
  // write to a record, exactly as editing a folio is.
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
  // The board is a destination, so it gets an entry of its own. It had one
  // until the 2026-08 rename took it, which is the whole reason
  // `ProjectQuestsViewSwitcher` had to be invented — the board was
  // unreachable from the UI at all.
  //
  // Not folded into the Quests entry's `active` set: these are two surfaces
  // now, and the sidebar should say which one you are on.
  if (features.kanban) {
    workItems.push({
      label: tr("project.menu.kanban"),
      icon: Columns3,
      href: router.path("projectKanban", { params: { projectSlug } }),
      active: name === "projectKanban",
    });
  }
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

  // Record: what the project keeps. Ordered by how much of it you write
  // yourself - a folio entirely, a release by deciding what goes in it, a
  // report not at all.
  const recordItems: NavGroup["items"] = [];
  if (features.folios) {
    recordItems.push({
      label: tr("project.menu.folios"),
      icon: BookOpen,
      href: router.path("projectFolios", { params: { projectSlug } }),
      active: name.startsWith("projectFolios"),
    });
  }
  // Between Folios and Reports. `active` covers the list and one release,
  // unchanged by the move.
  if (features.milestones) {
    recordItems.push({
      label: tr("project.menu.releases"),
      icon: Flag,
      href: router.path("projectReleases", { params: { projectSlug } }),
      active: name === "projectReleases" || name === "projectRelease",
    });
  }
  // No feature gate, deliberately, which is also why Record can never be
  // empty and the `.filter` below never drops it.
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
    <>
      {/* Renders nothing; publishes `nav` for the ⌘K palette. Its own
          component because this view returns early above and hooks may not
          sit below a return. */}
      <ProjectViewNavPublisher nav={nav} />
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
        {/* The "Quest list | Kanban board" rail used to sit here, as the
          first child of the content area. It is gone: the sidebar carries
          Quests and Kanban as two entries and each page has its own route
          and breadcrumb, so the rail was a second way to do the same
          navigation, under a breadcrumb already saying where you were.

          ⚠️ It existed for two real bugs, and neither may come back. The
          board was once unreachable from the UI at all (#1135), and picking
          it once trapped the project on the board (#1156). Both were fixed
          by making Kanban a ROUTE with a sidebar entry, which is what makes
          the rail redundant rather than merely noisy - so the sidebar entry
          is now the only way in, and Quests must keep landing on the list.
          `defaultSurface` is the only thing that may send a bare
          `/:projectSlug` to the board. */}
        <div className="flex h-full flex-col">
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
    </>
  );
};

export default ProjectView;
