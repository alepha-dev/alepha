import { Skeleton } from "@alepha/ui";

/**
 * What a Requirements tab draws while its list loads (#E153): a toolbar and
 * rows in outline, where a table header used to sit over an empty body.
 */
const ListSkeleton = () => (
  <div className="flex flex-col gap-3 p-4" data-testid="list-skeleton">
    <Skeleton className="h-9 w-full" />
    <Skeleton className="h-10 w-full" />
    <Skeleton className="h-10 w-full" />
    <Skeleton className="h-10 w-full" />
  </div>
);

export default ListSkeleton;
