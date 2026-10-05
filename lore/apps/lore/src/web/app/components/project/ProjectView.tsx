import { AppShell, type NavGroup } from "@alepha/ui/shell";
import { useAlepha, useInject, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { NestedView, useRouter, useRouterState } from "alepha/react/router";
import { Cog } from "lucide-react";

import { currentProjectAtom } from "../../atoms/currentProjectAtom.ts";
import { ProjectShellRegistry } from "../../registries/ProjectShellRegistry.ts";
import type { I18n } from "../../services/I18n.ts";
import HeaderActions from "../shared/header/HeaderActions.tsx";
import HeaderRepositoryButton from "../shared/header/HeaderRepositoryButton.tsx";
import HeaderSearchButton from "../shared/header/HeaderSearchButton.tsx";
import { useAtomsVersion } from "../shared/useAtomsVersion.ts";
import type {
  CapabilityNavEntry,
  ProjectShellContext,
} from "./capabilityNav.ts";
import ProjectActionsCreateButton from "./ProjectActionsCreateButton.tsx";
import ProjectInboxButton from "./ProjectInboxButton.tsx";
import ProjectSwitcher from "./ProjectSwitcher.tsx";
import ProjectViewNavPublisher from "./ProjectViewNavPublisher.tsx";
import {
  ROUTES_FULL_WIDTH,
  SECTION_HREF_ROUTES,
  SECTION_LABEL_KEYS,
} from "./projectViewRoutes.ts";
import { visibleSettingsTabs } from "./settings/projectSettingsSections.ts";

const ProjectView = () => {
  const routerState = useRouterState();
  const router = useRouter();
  const alepha = useAlepha();
  const shell = useInject(ProjectShellRegistry);
  const { tr } = useI18n<I18n, "en">();
  const name = routerState.name ?? "";
  const aside = shell.asideFor(name);
  const fullWidth = ROUTES_FULL_WIDTH.has(name);
  const activeSettings = shell.findSettingsTab(name);

  const [project] = useStore(currentProjectAtom);
  // Every module atom a registered badge, predicate or breadcrumb reads,
  // subscribed to once: the registered functions read them through
  // `context.get`, never through a hook (#E75, #Q2624).
  useAtomsVersion(shell.reads());

  if (!project) {
    return null;
  }

  const context: ProjectShellContext = {
    routeName: name,
    params: routerState.params,
    get: (atom) => alepha.store.get(atom),
  };

  const projectSlug = project.slug;

  // The sidebar, computed from the capability set rather than written as a
  // chain of nine `if (features.x)`. `capabilityNav.ts` is the declaration;
  // this is the only place it is read, and `projectNavAtom` reads THIS, which
  // is what stops the palette disagreeing with the sidebar about what pages
  // exist.
  //
  // Four bands, unlabelled (`NavGroup.label` omitted on purpose, the great
  // rename Task 9):
  //
  //   Activity  Activity
  //   Work      Quests, Kanban, Epics, Feedback, Blights
  //   Record    Folios, Releases, Reports
  //   Ops       Apps, Artifacts
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
  // written-to surface in the app.
  //
  // Releases moved back to Record on 2026-08-30, at the owner's request, and
  // this is the SECOND time that entry has moved, so both trips stay written
  // down rather than left for a third. It sat in Record originally because
  // the entity was thin; epic #14 falsified every clause of that and moved it
  // to Work. What that argument got wrong was the axis, not the facts: a
  // release is a record - the named thing you publish, freeze and keep - and
  // attaching an epic to one is a write to a record, exactly as editing a
  // folio is.
  //
  // Groups with no items are dropped by the `.filter` below, so a project with
  // every capability off still renders a clean sidebar: Activity, Reports and
  // Settings.
  const toItem = (entry: CapabilityNavEntry): NavGroup["items"][number] => ({
    label: tr(entry.labelKey as never),
    icon: entry.icon,
    href: router.path(entry.route as never, { params: { projectSlug } }),
    active: entry.activeOn ? entry.activeOn(name) : name === entry.route,
    badge: entry.badge?.(context),
  });

  // Core's entries and every module's, narrowed by capability, option,
  // data and rank (`ProjectShellRegistry.offeredNav`).
  const offered = shell.offeredNav(project, context);

  // Sorted by the entry's own `order`, not by which capability it came from:
  // Record reads Folios, Releases, Reports - Knowledge, then Work, then Core -
  // and the capability enum would put Reports first.
  const itemsOf = (group: CapabilityNavEntry["group"]) =>
    offered
      .filter((entry) => entry.group === group)
      .sort((a, b) => a.order - b.order)
      .map(toItem);

  const activityItems = itemsOf("activity");
  const workItems = itemsOf("work");
  const recordItems = itemsOf("record");
  const opsItems = itemsOf("ops");

  const nav: NavGroup[] = [
    // Activity is a group of one, above Work, so the separator the groups
    // already draw falls between it and Quests. A hand-placed divider would
    // do the same thing once and then disagree with the four below it.
    //
    // It is alone rather than at the top of Work because it is not work: it
    // is the view over every other group, and the project's landing page.
    { items: activityItems },
    { items: workItems },
    { items: recordItems },
    { items: opsItems },
    {
      items: [
        {
          // A collapsible group since #Q2565, where it used to be one link
          // into a page carrying its own second nav rail. The shell opens it
          // by itself while one of its children is the active route, and a
          // section whose capability is off is not listed: its master switch
          // is in General, which always is.
          label: tr("project.menu.settings"),
          icon: Cog,
          children: shell.settingsSections().flatMap((section) => {
            const tabs = visibleSettingsTabs(section, project);
            const first = tabs[0];
            if (!first) return [];
            return [
              {
                label: tr(section.labelKey as never),
                icon: section.icon,
                href: router.path(first.route, { params: { projectSlug } }),
                active: activeSettings?.section.key === section.key,
              },
            ];
          }),
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
  // A settings page adds its section, "Project › Settings › Quests", since
  // the sidebar group is now the only other thing naming it (#Q2565).
  if (activeSettings) {
    breadcrumbs.push({ label: tr(activeSettings.section.labelKey as never) });
  }
  // A detail page's own leaf (an instance, `#2`, `#1208`, a release tag,
  // `#F12`), each contributed by the module that owns the page.
  for (const contribution of shell.crumbContributions()) {
    const crumb = contribution.crumb({
      ...context,
      projectSlug,
      path: (route, params) => router.path(route as never, { params }),
    });
    if (crumb) breadcrumbs.push(crumb);
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
        // `Layout` mounts the bar at the root, which is the only place it can
        // see the transitions that enter and leave this shell. Leaving the
        // default on would draw a second, identical one on top of it.
        //
        // No `actionErrorToaster={false}` beside it, although `Layout` mounts
        // that listener at the root too: `embedded` already skips the shell's
        // own `Toaster` and `ActionErrorToaster`, and the prop is ignored.
        progress={false}
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
            {/* Through `before`, not as a sibling: that puts the create
              button and the magnifier in the cluster's own flex row, so they
              take its `gap-1` rather than the `gap-2` `AppShell` puts between
              topbar actions, which left a wider gap after the "+" than
              between any other two icons.

              The repository link rides the same slot, which is what puts it
              "between search and lang" (feedback #2105) without any of the
              three components needing to know about the other two: `before`
              is one node, and the order inside it is the order on screen. It
              renders nothing when the project has no `repositoryUrl`.

              ⚠️ The bell rides the same slot rather than joining
              `AppActions`, and that is a decision rather than convenience:
              that cluster is "the ambient controls EVERY signed-in surface
              carries", and the owner ruled the bell renders in the project
              shell only. A `showInbox` prop on a component whose whole
              argument is that it has no `show` props would be the drift it
              exists to end. `HeaderActions`'s own docstring already settled
              the same question for search: whether a control belongs on a
              surface is the surface's to decide.

              Last node, so the order reads create, search, repository,
              bell, account. */}
            <HeaderActions
              before={
                <>
                  <ProjectActionsCreateButton />
                  <HeaderSearchButton />
                  {/* ⚠️ Hidden below `sm`, like the three settings controls
                      inside the cluster (feedback #P2144). It is the one of
                      the four that is safe to simply drop: an outbound link
                      to the project's repository, which a phone reader can
                      reach from the project's own settings. `contents` so
                      the button stays a direct child of the flex row and
                      keeps its gap. */}
                  <span className="hidden sm:contents">
                    <HeaderRepositoryButton />
                  </span>
                  <ProjectInboxButton />
                </>
              }
            />
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
          Nothing may send a bare `/:projectSlug` to the board: the
          `defaultSurface` setting that once could is gone (feedback #2066). */}
        <div className="flex h-full flex-col">
          <div className="flex min-h-0 w-full min-w-0 flex-1 flex-col">
            <div
              className={`flex min-h-0 flex-1 flex-col ${aside || fullWidth ? "overflow-hidden" : "overflow-auto"}`}
            >
              {aside ? (
                <div className="flex min-h-0 flex-1">
                  {/* The module's pane (Work's quest log), which owns its
                    width, collapse state and breakpoint. */}
                  <aside.component />
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
