import { Skeleton } from "../core/Skeleton.tsx";
import { cn } from "../core/utils.ts";

export interface SettingsDialogSkeletonProps {
  className?: string;
}

/**
 * What a settings section shows while its chunk loads: a heading and two
 * cards' worth of lines, the shape most sections take.
 */
export const SettingsDialogSkeleton = (props: SettingsDialogSkeletonProps) => (
  <div
    data-slot="settings-dialog-skeleton"
    className={cn("flex flex-col gap-4 p-6", props.className)}
    aria-busy="true"
  >
    <Skeleton className="h-6 w-40" />
    <Skeleton className="h-24 w-full" />
    <Skeleton className="h-24 w-full" />
  </div>
);
