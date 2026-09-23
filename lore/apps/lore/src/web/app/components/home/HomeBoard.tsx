import { useClient, useQuery, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";

import type { HomeController } from "@/api/controllers/HomeController.ts";

import { userProjectsAtom } from "../../atoms/userProjectsAtom.ts";
import type { I18n } from "../../services/I18n.ts";
import HomeHeader from "./HomeHeader.tsx";
import { HomeRecentProjects } from "./HomeRecentProjects.tsx";
import { HomeSearch } from "./HomeSearch.tsx";

/**
 * The signed-in landing page: your projects, and how each of them is moving.
 *
 * ## Two sources, one page
 *
 * The rows are `userProjectsAtom`, filled once at bootstrap by
 * `getHomeOverview` and shared with the switcher, Spotlight and the account
 * area. The bars, the last-activity stamps and the open counts come from
 * `getHomeBoard`, which is this page's alone - an aggregate over the audit
 * log on every route change is a cost the atom's other readers never asked
 * for.
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
  const { tr } = useI18n<I18n, "en">();
  const homeApi = useClient<HomeController>();
  const [overview] = useStore(userProjectsAtom);

  /**
   * Quiet on purpose. A board that cannot be read costs the bars, the
   * last-activity stamps and the open counts, and the table still lists every
   * project: the rows are already in memory. `onError` keeps the failure out
   * of the toaster and in error reporting.
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
  /**
   * `undefined` when the bars could not be read, which is NOT the same as
   * every project being quiet.
   *
   * Since #E65 the counts come from an `$analytics` dataset - on production an
   * HTTP call into Analytics Engine, a dependency the rest of this response
   * does not share - so the server answers without `momentum` rather than
   * failing the whole board. An empty Map here would mute every row as
   * inactive and draw fourteen zero bars, claiming a fortnight of silence
   * that never happened.
   */
  const momentum = board.data?.momentum
    ? new Map(
        board.data.momentum.map((entry) => [entry.projectId, entry.counts]),
      )
    : undefined;

  /**
   * Most recently active first: the board's last activity, or the overview's
   * `lastActivityAt` until the board arrives. Both come from the same read
   * (`ProjectRecencyService`), so a fresh load paints the final order on the
   * first frame; the board only moves a row when something happened since
   * the overview was read, such as a return to Home after working in a
   * project. Sorting that first frame by `updatedAt` reshuffled the list a
   * second after every load.
   */
  const recency = (project: { id: number; lastActivityAt: string }) =>
    Date.parse(lastActivity.get(project.id) ?? project.lastActivityAt);
  const projects = [...(overview?.projects ?? [])].sort(
    (a, b) => recency(b) - recency(a),
  );

  return (
    /*
      The page is a grid of four rules and nothing else: two rails down the
      full height at the gutters, and a full-width line under the header and
      above the footer. Header, main and footer are the three bands between
      them.
    */
    <div className="relative flex h-svh flex-col">
      {/*
        The rails. `pointer-events-none` and `aria-hidden`: they are rules on
        a page, not something to click or announce. `z-20` keeps them above
        anything in main that paints a background.
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
        One centred column between the rails: a greeting, the search box with
        its dropdown, and the recent projects. The search box's rule runs rail to rail, which
        is why main is flush to `mx-4` and the column carries its own width.

        No Recent activity panel: it read 15,989 audit rows per load to draw
        twenty lines until #E64, and no index fixes a nine-way merge over
        `scope_id`.
      */}
      <main className="lore-page-dots bg-background mx-4 min-h-0 flex-1 overflow-y-auto">
        <div className="flex flex-col gap-8 pt-14 pb-16 sm:pt-20">
          <h1 className="px-4 text-center text-3xl font-semibold tracking-tight">
            {tr("home.greeting")}
          </h1>
          <HomeSearch projects={projects} />
          <div className="mx-auto w-full max-w-5xl px-4 sm:px-8">
            <HomeRecentProjects
              projects={projects}
              momentum={momentum}
              days={days}
              lastActivity={lastActivity}
              openCounts={openCounts}
            />
          </div>
        </div>
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
