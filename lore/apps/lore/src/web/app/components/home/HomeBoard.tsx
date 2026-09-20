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
    /*
      The page is a grid of four rules and nothing else: two rails down the
      full height at the gutters, and a full-width line under the header and
      above the footer. Header, main and footer are the three bands between
      them, and `S` is the page background left and right of the rails.

      ⚠️ The blocks inside main draw NO frame of their own (`flat` on the
      table, one left border on the panel): their edges are these rules, and
      a border on them would be a second line one pixel away.
    */
    <div className="relative flex h-svh flex-col">
      {/*
        The rails, drawn OVER the blocks' own background: main is flush to
        `mx-4`, exactly where they sit, so a rail under it would be painted
        out. `pointer-events-none` and `aria-hidden`: they are rules on a
        page, not something to click or announce.

        ⚠️ `z-20`, not `z-10`: the table's column header is `sticky z-10`, so
        at equal z-index the later element in the DOM won and its band
        covered the rail beside it - a gap in the line for exactly the height
        of the header. Anything that floats (a popover, a dropdown) is
        portalled at `z-50` and is unaffected.
      */}
      <div
        aria-hidden
        className="bg-border pointer-events-none absolute inset-y-0 left-4 z-20 w-px"
      />
      <div
        aria-hidden
        className="bg-border pointer-events-none absolute inset-y-0 right-4 z-20 w-px"
      />
      <HomeHeader />
      {/*
        The two blocks side by side: the table on the left, the activity
        panel on the right, drawn as one unit whose outer edges are the
        rails. The panel's left border is the line between them.

        `mx-4` puts those edges exactly on the rails. The page dots are
        painted here, behind both blocks, so they run as one grid across the
        line between them.
      */}
      <main className="lore-page-dots bg-background mx-4 flex min-h-0 flex-1 flex-row">
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
      </main>
      {/*
        The footer band: `h-4`, exactly the space the rails leave left and
        right, so the frame keeps the same margin on three sides and the
        bottom rule sits where the eye expects it. Empty - what belongs in it
        is a separate decision - so it is that much page background under its
        own line.
      */}
      <footer className="h-4 shrink-0 border-t" />
    </div>
  );
};

export default HomeBoard;
