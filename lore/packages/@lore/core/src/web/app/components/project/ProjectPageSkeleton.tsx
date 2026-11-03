import { Skeleton } from "@alepha/ui";

/**
 * A project page on its way: what `$page({ loading })` shows in the shell's
 * slot while a quest, an epic, an app or a stack loads. In the static graph of
 * every router that names it, so it stays this small.
 */
const ProjectPageSkeleton = () => {
  return (
    <div
      className="flex min-h-0 flex-1 flex-col gap-4 p-6"
      data-testid="project-page-skeleton"
    >
      <Skeleton className="h-7 w-2/3" />
      <Skeleton className="h-4 w-1/3" />
      <Skeleton className="min-h-0 flex-1" />
    </div>
  );
};

export default ProjectPageSkeleton;
