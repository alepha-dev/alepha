import { Skeleton } from "@alepha/ui";

/**
 * The quest log's shape while its chunk loads: the header, the search field,
 * and three area groups of rows, at the sizes `QuestLog` draws them, so the
 * real list replaces it without anything moving.
 */
const QuestLogSkeleton = () => (
  <div
    data-testid="quest-log-skeleton"
    className="flex h-full w-full min-w-0 flex-1 flex-col"
    aria-hidden="true"
  >
    <div className="flex h-11 shrink-0 items-center gap-2 px-3">
      <Skeleton className="size-4 rounded" />
      <Skeleton className="h-4 w-20" />
      <Skeleton className="h-4 w-6 rounded-full" />
    </div>
    <div className="shrink-0 px-3 pb-2">
      <Skeleton className="h-8 w-full rounded-md" />
    </div>
    <div className="flex flex-col px-2">
      {GROUPS.map((rows, group) => (
        <div key={group} className="mb-2 flex flex-col">
          <div className="flex h-7 items-center gap-1.5 px-1.5">
            <Skeleton className="size-3.5 rounded" />
            <Skeleton className="size-2 rounded-full" />
            <Skeleton className="h-3 w-24" />
          </div>
          {Array.from({ length: rows }, (_, row) => (
            <div key={row} className="flex h-8 items-center gap-2 pr-2 pl-6">
              <Skeleton className="size-3.5 shrink-0 rounded" />
              <Skeleton
                className="h-3.5"
                style={{
                  width: `${ROW_WIDTHS[(group + row) % ROW_WIDTHS.length]}%`,
                }}
              />
            </div>
          ))}
        </div>
      ))}
    </div>
  </div>
);

/**
 * Rows per placeholder group, and the title widths they cycle through, so
 * the skeleton reads as a list rather than a striped block.
 */
const GROUPS = [2, 3, 1];
const ROW_WIDTHS = [72, 58, 80, 64];

export default QuestLogSkeleton;
