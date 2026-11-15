import { Skeleton } from "@alepha/ui";

/**
 * The Uptime tab while its monitor loads (#Q3695): the loaded page's shape,
 * the title and target lines, the status line and the Recent checks card
 * with its bar, so nothing jumps when the data lands.
 */
const AppUptimeSkeleton = () => (
  <div className="flex flex-col gap-6" data-testid="app-uptime-skeleton">
    <div>
      <Skeleton className="h-8 w-64" />
      <Skeleton className="mt-2 h-4 w-80" />
      <Skeleton className="mt-4 h-5 w-48" />
    </div>
    <div className="bg-card rounded-lg border p-4">
      <Skeleton className="mb-3 h-4 w-28" />
      <Skeleton className="h-7 w-full" />
    </div>
  </div>
);

export default AppUptimeSkeleton;
