/**
 * The route-name tables `ProjectView` reads to shape the shell around the
 * page that is open: which pages carry the quest log, which run full width,
 * and where each section's breadcrumb climbs back to.
 *
 * Route names are plain strings here with nothing in the type system tying
 * them to the route table, so a `$page` added to `AppRouter` and left out of
 * one of these sets is not a compile error. It is a page that renders in the
 * centred column while its siblings run full width, a sidebar that stops
 * highlighting, and a crumb that goes dead. That is how the Explore tab
 * shipped (quest #1689), which is why these live in their own module: the
 * spec beside it walks the router and refuses the next half-registered tab.
 */

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
export const ROUTES_WITH_QUEST_LOG = new Set(["projectQuests", "projectQuest"]);

/**
 * The per-app page and its tabs.
 *
 * Every tab declared under `projectApp` in `AppRouter` belongs here, and
 * `projectViewRoutes.spec.ts` checks that it is. The set drives the width of
 * the page, the highlighted app in the sidebar and the app's own breadcrumb
 * leaf, so a tab missing from it breaks all three at once and silently.
 */
export const ROUTES_APP = new Set([
  "projectApp",
  "app",
  "projectApps",
  "appAnalytics",
  "appAnalyticsDimension",
  "appVitals",
  "appErrors",
  "appExplore",
  "appArtifacts",
  "appSettings",
]);

export const ROUTES_FULL_WIDTH = new Set([
  // The project's landing page. Full width because it is a feed of one
  // column of rows plus a filter bar, and a centred 1024px column would
  // leave the project background down both sides of the page you open on.
  "projectActivity",
  "projectQuest",
  "projectKanban",
  "projectEpics",
  "projectEpic",
  "projectReleases",
  // The release view is a full-width plate over four tabs, and it owns its
  // own scroll: the plate stays put while a tab body scrolls under it. Capped
  // and centred, the plate would sit in a 1024px column with a gutter down
  // both sides and the artifact table would lose the width it is built for.
  "projectRelease",
  // Reports, for the same reason as the release view above and on the same
  // layout since #1693: a full-width plate over tabs that owns its own scroll.
  // Capped, the plate sat in a centred column with the project background down
  // both sides, and the OUTER container kept `overflow-auto`, so the whole
  // page scrolled instead of the tab body under a plate that should stay put
  // (feedback #2079, at 1920x929).
  //
  // The shell is listed alongside the four leaves although `ProjectView` only
  // ever reads the active leaf: a set that names four of the five is a trap
  // for whoever adds the sixth.
  "projectReports",
  "reportsOverview",
  "reportsQuests",
  "reportsMembers",
  "reportsQuality",
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
export const SECTION_HREF_ROUTES: Record<
  string,
  | "projectFolios"
  | "projectEpics"
  | "projectQuests"
  | "projectApps"
  | "projectReleases"
> = {
  projectFolios: "projectFolios",
  projectFoliosNew: "projectFolios",
  projectFoliosFolio: "projectFolios",
  projectEpic: "projectEpics",
  projectQuest: "projectQuests",
  projectRelease: "projectReleases",
  projectApp: "projectApps",
  app: "projectApps",
  appAnalytics: "projectApps",
  appAnalyticsDimension: "projectApps",
  appVitals: "projectApps",
  appErrors: "projectApps",
  appExplore: "projectApps",
  appArtifacts: "projectApps",
  appSettings: "projectApps",
};

export const SECTION_LABEL_KEYS: Record<string, string> = {
  // Deliberately absent from `SECTION_HREF_ROUTES` above: Activity is a
  // leaf with no detail route under it, so its crumb is the open page and
  // stays inert, the same reading as `projectQuests` on the list itself.
  projectActivity: "project.menu.activity",
  projectQuests: "project.menu.quests",
  projectQuest: "project.menu.quests",
  projectKanban: "project.menu.kanban",
  projectEpics: "project.menu.epics",
  projectEpic: "project.menu.epics",
  projectReleases: "project.menu.releases",
  projectRelease: "project.menu.releases",
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
  appErrors: "project.menu.apps",
  appExplore: "project.menu.apps",
  appArtifacts: "project.menu.apps",
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
