import { Skeleton } from "@alepha/ui";

/**
 * The board before its first read lands.
 *
 * ⚠️ Not the empty state. Zero cards because nothing is read yet and zero
 * cards because the project has none were the same render, so every open
 * flashed the centred Add card for as long as the read took. This holds the
 * header's and the grid's shape instead, with the same tile track as
 * `DashboardGrid`, so the board drops into place rather than jumping.
 */
const ProjectDashboardLoading = () => {
  return (
    <div data-testid="dashboard-loading" aria-busy="true">
      <div className="mb-5 flex flex-col gap-2">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-3.5 w-32" />
      </div>
      <div className="grid auto-rows-[168px] grid-cols-1 items-stretch gap-3 sm:grid-cols-[repeat(auto-fill,minmax(clamp(216px,15cqw,300px),1fr))]">
        {TILES.map((tile) => (
          <Skeleton key={tile} className="h-full w-full rounded-xl" />
        ))}
      </div>
    </div>
  );
};

/**
 * Four tiles: one row at the usual width, never a guess at the real count.
 */
const TILES = [0, 1, 2, 3];

export default ProjectDashboardLoading;
