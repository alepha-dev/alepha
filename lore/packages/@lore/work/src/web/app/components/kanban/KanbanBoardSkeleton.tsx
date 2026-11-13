import { Skeleton } from "@alepha/ui";

/**
 * The board's shape while its first read is in flight: the chrome filter bar
 * and three columns of placeholder cards, laid out as `KanbanBoard` lays out
 * its own, so the real board replaces it in place rather than after a blank
 * page.
 */
const KanbanBoardSkeleton = () => (
  <div
    data-testid="kanban-board-skeleton"
    aria-busy="true"
    className="flex flex-1 flex-col overflow-hidden"
  >
    <div className="border-border bg-muted flex shrink-0 items-center gap-2 border-b px-3 py-1.5 shadow-[inset_0_1px_0_0_var(--bevel)]">
      <Skeleton className="h-7 w-44" />
      <Skeleton className="h-7 w-36" />
      <Skeleton className="h-7 w-36" />
      <div className="ml-auto flex gap-1">
        <Skeleton className="h-7 w-20" />
        <Skeleton className="h-7 w-20" />
        <Skeleton className="h-7 w-20" />
      </div>
    </div>
    <div className="flex flex-1 overflow-hidden">
      {COLUMNS.map((cards, column) => (
        <div
          key={column}
          className={`flex min-w-[260px] flex-1 flex-col ${
            column < COLUMNS.length - 1 ? "border-border border-r" : ""
          }`}
        >
          <div className="border-border flex items-center gap-2 border-b px-3 py-2">
            <Skeleton className="size-2 rounded-full" />
            <Skeleton className="h-4 w-24" />
          </div>
          <div className="flex flex-col gap-1 p-1">
            {Array.from({ length: cards }, (_, card) => (
              <Skeleton key={card} className="h-14 w-full rounded-md" />
            ))}
          </div>
        </div>
      ))}
    </div>
  </div>
);

/**
 * Placeholder cards per column: To do, In Progress, Completed.
 */
const COLUMNS = [3, 2, 1];

export default KanbanBoardSkeleton;
