import { useClient, useQuery } from "alepha/react";
import { use } from "react";

import type { HomeController } from "../../../../api/controllers/HomeController.ts";
import type { HomeBoardResource } from "../../../../api/schemas/homeBoardSchema.ts";
import type { ProjectOverviewResource } from "../../../../api/schemas/projectResourceSchema.ts";
import { HomeRecentProjects } from "./HomeRecentProjects.tsx";

export interface HomeBoardProjectsProps {
  /**
   * The `home` loader's deferred board. It settles to `undefined` when the
   * read failed, which is when this component fetches it itself.
   */
  board: Promise<HomeBoardResource | undefined>;
  projects: ProjectOverviewResource[];
}

/**
 * The recent projects with what the board adds to them: the bars, the
 * last-activity stamps and the open counts.
 *
 * Suspends on the board, so it sits under a `<Suspense>` showing the same rows
 * without those three, and the page around it is usable meanwhile.
 *
 * ## One resolve, no polling
 *
 * The loader reads once per entry, and the fallback `useQuery` fetches on
 * mount and when something asks it to refetch. There is deliberately no
 * interval: the QuestGraph incident (folio #1057) was a loader revalidating
 * once per second for 51 minutes, producing 4,009 identical requests from one
 * browser tab - roughly 35% of that day's account-wide Worker invocations -
 * and the landing page is the worst place to repeat it.
 */
export const HomeBoardProjects = (props: HomeBoardProjectsProps) => {
  const homeApi = useClient<HomeController>();
  const preloaded = use(props.board);

  /**
   * Quiet on purpose. A board that cannot be read costs the bars, the
   * last-activity stamps and the open counts, and the table still lists every
   * project: the rows are already in memory. `onError` keeps the failure out
   * of the toaster and in error reporting.
   */
  const fetched = useQuery(
    {
      key: ["home-board"],
      handler: () => homeApi.getHomeBoard(),
      onError: () => {},
      // The loader's read failed: only then does the page fetch it itself.
      enabled: preloaded === undefined,
    },
    [homeApi, preloaded === undefined],
  );
  const board = preloaded ?? fetched.data;

  const days = board?.days ?? [];
  const lastActivity = new Map(
    (board?.lastActivity ?? []).map((entry) => [entry.projectId, entry.at]),
  );
  const openCounts = new Map(
    (board?.openCounts ?? []).map((entry) => [entry.projectId, entry]),
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
  const momentum = board?.momentum
    ? new Map(board.momentum.map((entry) => [entry.projectId, entry.counts]))
    : undefined;

  /**
   * The board's last activity, over the overview's `lastActivityAt`. Both come
   * from the same read (`ProjectRecencyService`), so the rows do not move when
   * the board lands: it only moves one when something happened since the
   * overview was read, such as a return to Home after working in a project.
   */
  const recency = (project: { id: number; lastActivityAt: string }) =>
    Date.parse(lastActivity.get(project.id) ?? project.lastActivityAt);
  const projects = [...props.projects].sort((a, b) => recency(b) - recency(a));

  return (
    <HomeRecentProjects
      projects={projects}
      momentum={momentum}
      days={days}
      lastActivity={lastActivity}
      openCounts={openCounts}
    />
  );
};
