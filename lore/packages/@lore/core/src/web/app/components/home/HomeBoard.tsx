import { useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Suspense } from "react";

import type { HomeBoardResource } from "../../../../api/schemas/homeBoardSchema.ts";
import { userProjectsAtom } from "../../atoms/userProjectsAtom.ts";
import type { I18n } from "../../services/I18n.ts";
import { HomeBoardProjects } from "./HomeBoardProjects.tsx";
import HomeHeader from "./HomeHeader.tsx";
import { HomeRecentProjects } from "./HomeRecentProjects.tsx";
import { HomeSearch } from "./HomeSearch.tsx";

export interface HomeBoardProps {
  board: Promise<HomeBoardResource | undefined>;
}

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
 * for. The `home` route loader hands it over deferred: the momentum half is an
 * HTTP call into Analytics Engine, and a slow one must not hold the page, so
 * the rows paint and the search box works while it is on its way.
 */
const HomeBoard = (props: HomeBoardProps) => {
  const { tr } = useI18n<I18n, "en">();
  const [overview] = useStore(userProjectsAtom);

  // Most recently active first, from the overview's `lastActivityAt`.
  // Archived projects are left out (#Q2601): My projects still lists them.
  const projects = (overview?.projects ?? [])
    .filter((it) => !it.archivedAt)
    .sort(
      (a, b) => Date.parse(b.lastActivityAt) - Date.parse(a.lastActivityAt),
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
            <Suspense
              fallback={
                <HomeRecentProjects
                  projects={projects}
                  momentum={undefined}
                  days={[]}
                  lastActivity={new Map()}
                  openCounts={new Map()}
                />
              }
            >
              <HomeBoardProjects board={props.board} projects={projects} />
            </Suspense>
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
