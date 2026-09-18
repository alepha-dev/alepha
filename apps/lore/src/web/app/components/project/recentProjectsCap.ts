/**
 * How many projects `ProjectSwitcher` lists before deferring to the full list
 * at `/account/projects`.
 *
 * ⚠️ **It has one reader now.** It used to be shared with the landing page's
 * rail and the inline list beside it, and the argument for a single constant
 * was that the three had to agree: they were views of one "your recent
 * projects" idea, and a reader who counted ten in one and eleven in another
 * learned that one of them was lying about what "recent" means. The landing
 * page is a table of every project, paged, so there is nothing left to
 * disagree with. The constant stays because the switcher still truncates and
 * the reasoning below still applies to it.
 *
 * ⚠️ This is a DISPLAY cap only. It must never be pushed down into
 * `getHomeOverview` or into `userProjectsAtom`, whose contract is the COMPLETE
 * membership list — `Spotlight` filters that array client-side to search
 * projects by name, so a truncated atom would quietly reduce ⌘K to finding
 * whichever ten sorted highest. The atom's own docstring records that it was
 * a top-N sample once and that the cap was removed for exactly this reason.
 *
 * Slicing here costs nothing: the array is already in memory, already ordered
 * most-recently-updated first by `getHomeOverview`, so the menu pays no
 * request for its ten.
 */
export const RECENT_PROJECTS_CAP = 10;
