import { useClient, useQuery, useStore } from "alepha/react";

import type { HomeController } from "@/api/controllers/HomeController.ts";

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
  const lastActivity = new Map(
    (board.data?.lastActivity ?? []).map((entry) => [
      entry.projectId,
      entry.at,
    ]),
  );
  const openCounts = new Map(
    (board.data?.openCounts ?? []).map((entry) => [entry.projectId, entry]),
  );
  const momentum = new Map(
    (board.data?.momentum ?? []).map((entry) => [
      entry.projectId,
      entry.counts,
    ]),
  );

  return (
    <div className="flex h-svh flex-col">
      <HomeHeader />
      {/* Two blocks side by side and no card around them: the table on the
          left, the activity panel on the right, drawn as one unit. The table
          squares its right corners and its right border is the line between
          the two; the panel carries the top, right and bottom borders and the
          rounded corners on that side. Below `lg` the panel is hidden and the
          table keeps all four corners (`squareRight="lg"`).

          No top gutter: the header carries no rule, so the blocks' own top
          border is what separates them from it.

          The surface is a project's main panel: `bg-background` (what the
          shell's inset gives it) and the page dots (its `mainClassName`),
          painted here, behind both blocks, so the dots run as one grid across
          the line between them. Margins rather than padding, so this box is
          exactly the two blocks and the gutter around them keeps the page's
          own background. */}
      <div className="lore-page-dots bg-background mx-4 mb-4 flex min-h-0 flex-1 flex-row rounded-md">
        <HomeProjectsTable
          projects={projects}
          momentum={momentum}
          days={days}
          lastActivity={lastActivity}
          openCounts={openCounts}
        />
        <HomeActivityPanel
          rows={board.data?.activity ?? []}
          projects={projects}
          loading={board.loading}
        />
      </div>
    </div>
  );
};

export default HomeBoard;
