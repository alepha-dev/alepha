import { Card } from "@alepha/ui";
import { useClient, useQuery, useStore } from "alepha/react";
import { useState } from "react";

import type { HomeController } from "@/api/controllers/HomeController.ts";
import type { ProjectOverviewResource } from "@/api/schemas/projectResourceSchema.ts";

import { userProjectsAtom } from "../../atoms/userProjectsAtom.ts";
import { HomeActivityPanel } from "./HomeActivityPanel.tsx";
import HomeHeader from "./HomeHeader.tsx";
import { HomeProjectsTable } from "./HomeProjectsTable.tsx";

/**
 * The signed-in landing page: your projects, and what has been happening in
 * them.
 *
 * ## Two sources, one page
 *
 * The rows are `userProjectsAtom`, filled once at bootstrap by
 * `getHomeOverview` and shared with the switcher, Spotlight and the account
 * area. The bars and the activity lines come from `getHomeBoard`, which is
 * this page's alone - an aggregate over the audit log on every route change
 * is a cost the atom's other readers never asked for.
 *
 * ## One resolve, no polling
 *
 * `useQuery` fetches on mount and when something asks it to refetch. There is
 * deliberately no interval: the QuestGraph incident (folio #1057) was a loader
 * revalidating once per second for 51 minutes, producing 4,009 identical
 * requests from one browser tab - roughly 35% of that day's account-wide
 * Worker invocations - and the landing page is the worst place to repeat it.
 */
const HomeBoard = () => {
  const homeApi = useClient<HomeController>();
  const [overview] = useStore(userProjectsAtom);
  /**
   * The row the pointer is on. Pointer state, so it is `useState` and not an
   * atom: nothing outside this page reads it, and it dies with the page.
   */
  const [focused, setFocused] = useState<ProjectOverviewResource>();

  const projects = overview?.projects ?? [];

  /**
   * Quiet on purpose. A board that cannot be read costs the bars and the
   * panel, and the table beside them still lists every project: the rows are
   * already in memory. `onError` keeps the failure out of the toaster and in
   * error reporting.
   */
  const board = useQuery(
    {
      key: ["home-board"],
      handler: () => homeApi.getHomeBoard(),
      onError: () => {},
    },
    [homeApi],
  );

  const days = board.data?.days ?? [];
  const momentum = new Map(
    (board.data?.momentum ?? []).map((entry) => [
      entry.projectId,
      entry.counts,
    ]),
  );

  return (
    <div className="flex h-svh flex-col">
      <HomeHeader />
      {/* No top gutter: the header carries no rule, so the card's own top
          edge is what separates it from the header. */}
      <div className="min-h-0 flex-1 px-4 pb-4">
        {/* `gap-0` as well as `p-0`: a Card is a column of stacked blocks by
            default and spaces them with `--card-spacing`, which between these
            two panes is a gutter down the middle of one object. The panel's
            own left border is the divider. */}
        {/* The quest log's lattice, as the card's own material. It is drawn by
            a `z-index: -1` pseudo inside the element's stacking context, so it
            sits above the card's background and below its content. */}
        <Card className="lore-quest-log-facets flex h-full min-h-0 flex-row gap-0 overflow-hidden p-0">
          {/* No padding: the table is the pane, so its own toolbar, header
              row and footer are what set the inset. A gutter here would put
              the card's border and the table's own rules a few pixels apart,
              which reads as a misalignment rather than as breathing room. */}
          {/* `bg-card` and not transparent: the table is a grid of rows and
              rules, and a lattice reading through it is two grids fighting.
              The panel beside it has the texture; the table has a surface. */}
          <div className="bg-card flex min-h-0 min-w-0 flex-1 flex-col">
            <HomeProjectsTable
              projects={projects}
              momentum={momentum}
              days={days}
              onHover={setFocused}
              // A deleted project has to leave the bars and the panel too, and
              // both come from the one request this page makes.
              onChanged={() => board.refetch()}
            />
          </div>
          <HomeActivityPanel
            rows={board.data?.activity ?? []}
            projects={projects}
            focused={focused}
            loading={board.loading}
          />
        </Card>
      </div>
    </div>
  );
};

export default HomeBoard;
