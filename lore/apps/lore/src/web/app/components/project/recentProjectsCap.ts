/**
 * How many projects the summary surfaces show before deferring to the full
 * list at `/account/projects`.
 *
 * One constant because the dashboard's rail and `ProjectSwitcher` must agree:
 * they are two views of the same "your recent projects" idea, and a reader who
 * counts five in one and six in the other learns that one of them is lying
 * about what "recent" means.
 *
 * It used to be Home's project card that made the first of those two. Home
 * hands that job to the dashboard for anyone who has projects at all, and
 * shows the hero to everyone else.
 *
 * ⚠️ This is a DISPLAY cap only. It must never be pushed down into
 * `getHomeOverview` or into `userProjectsAtom`, whose contract is the COMPLETE
 * membership list — `Spotlight` filters that array client-side to search
 * projects by name, so a truncated atom would quietly reduce ⌘K to finding
 * whichever five sorted highest. The atom's own docstring records that it was
 * a top-N sample once and that the cap was removed for exactly this reason.
 *
 * Slicing here costs nothing: the array is already in memory, already ordered
 * most-recently-updated first by `getHomeOverview`, so neither surface pays a
 * request for its five.
 */
export const RECENT_PROJECTS_CAP = 5;
