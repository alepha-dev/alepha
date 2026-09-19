import type { BucketStats, StorageStats } from "alepha/api/files";
import { useI18n } from "alepha/react/i18n";
import { useState } from "react";

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../core/Tooltip.tsx";
import { cn, formatBytes } from "../core/utils.ts";

export interface AdminFilesUsageCardProps {
  stats: StorageStats;
}

/**
 * The storage of every bucket in one tile: what is used, out of what quota,
 * a bar split by bucket, and a legend of the buckets with their sizes.
 *
 * With a quota the bar is drawn against it, so its empty track is the free
 * space. Without one there is nothing to be a share of, and the bar is the
 * split between buckets alone. Hovering a segment or a legend entry picks
 * that bucket out and gives its file count and share.
 */
export const AdminFilesUsageCard = (props: AdminFilesUsageCardProps) => {
  const { stats } = props;
  const { l, tr } = useI18n();
  const [active, setActive] = useState<string | undefined>();

  const buckets = [...stats.byBucket].sort((a, b) => b.totalSize - a.totalSize);
  const hasQuota = stats.quota > 0;
  // `max` rather than the quota alone: a quota lowered below what is already
  // stored would otherwise draw segments past the end of the bar.
  const scale = Math.max(stats.quota, stats.totalSize) || 1;
  const percent = (ratio: number) =>
    l(ratio, { number: { style: "percent", maximumFractionDigits: 1 } });

  const detail = (bucket: BucketStats) =>
    tr("admin.files.usageBucketDetail", {
      default: `${bucket.bucket}: ${formatBytes(bucket.totalSize)}, ${bucket.fileCount} file(s), ${percent(bucket.totalSize / (stats.totalSize || 1))} of what is used`,
      args: [
        bucket.bucket,
        formatBytes(bucket.totalSize),
        l(bucket.fileCount),
        percent(bucket.totalSize / (stats.totalSize || 1)),
      ],
    });

  const dim = (bucket: BucketStats) =>
    active !== undefined && active !== bucket.bucket && "opacity-30";

  const hover = (bucket: BucketStats) => ({
    onMouseEnter: () => setActive(bucket.bucket),
    onMouseLeave: () => setActive(undefined),
    onFocus: () => setActive(bucket.bucket),
    onBlur: () => setActive(undefined),
  });

  return (
    <div
      data-slot="admin-files-usage"
      className="bg-background flex flex-col gap-3 rounded-md border px-4 py-3"
    >
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-3xl leading-none font-semibold tabular-nums">
          {formatBytes(stats.totalSize)}
        </span>
        <span className="text-muted-foreground text-sm">
          {hasQuota
            ? tr("admin.files.usageOfQuota", {
                default: `of ${formatBytes(stats.quota)} used`,
                args: [formatBytes(stats.quota)],
              })
            : tr("admin.files.usageUsed", { default: "used" })}
        </span>
        <span className="text-muted-foreground text-xs tabular-nums">
          {hasQuota
            ? tr("admin.files.usageFree", {
                default: `${formatBytes(Math.max(0, stats.quota - stats.totalSize))} free · ${percent(stats.totalSize / stats.quota)} used`,
                args: [
                  formatBytes(Math.max(0, stats.quota - stats.totalSize)),
                  percent(stats.totalSize / stats.quota),
                ],
              })
            : tr("admin.files.usageNoQuota", {
                default: `${stats.totalFiles} file(s), no quota`,
                args: [l(stats.totalFiles)],
              })}
        </span>
      </div>

      <TooltipProvider delay={100}>
        {/*
          Decorative for a screen reader: the legend under it says the same
          thing in words, bucket by bucket.
        */}
        <div
          aria-hidden
          className="bg-muted flex h-2.5 w-full overflow-hidden rounded-full"
        >
          {buckets.map((bucket, index) => (
            <Tooltip key={bucket.bucket}>
              <TooltipTrigger
                render={
                  <div
                    data-bucket={bucket.bucket}
                    style={{
                      width: `${(bucket.totalSize / scale) * 100}%`,
                    }}
                    // A floor, so a bucket of a few kilobytes beside one of
                    // gigabytes is still there to hover.
                    className={cn(
                      "h-full min-w-3 transition-opacity",
                      BUCKET_COLORS[index % BUCKET_COLORS.length],
                      dim(bucket),
                    )}
                    {...hover(bucket)}
                  />
                }
              />
              <TooltipContent>{detail(bucket)}</TooltipContent>
            </Tooltip>
          ))}
        </div>

        <ul className="flex flex-wrap gap-x-4 gap-y-1.5">
          {buckets.map((bucket, index) => (
            <li key={bucket.bucket}>
              <Tooltip>
                <TooltipTrigger
                  render={
                    // A button, so the detail a pointer gets on hover is one
                    // Tab away for a keyboard.
                    <button
                      type="button"
                      className={cn(
                        "focus-visible:ring-ring/50 flex items-center gap-1.5 rounded-sm text-sm transition-opacity outline-none focus-visible:ring-[3px]",
                        dim(bucket),
                      )}
                      {...hover(bucket)}
                    />
                  }
                >
                  <span
                    aria-hidden
                    className={cn(
                      "size-2 shrink-0 rounded-full",
                      BUCKET_COLORS[index % BUCKET_COLORS.length],
                    )}
                  />
                  <span>{bucket.bucket}</span>
                  <span className="text-muted-foreground font-mono text-xs">
                    {formatBytes(bucket.totalSize)}
                  </span>
                </TooltipTrigger>
                <TooltipContent>{detail(bucket)}</TooltipContent>
              </Tooltip>
            </li>
          ))}
        </ul>
      </TooltipProvider>
    </div>
  );
};

/**
 * One hue per bucket, largest first, and round again past the eighth.
 * Literal class names, since Tailwind finds classes by reading the source.
 */
const BUCKET_COLORS = [
  "bg-red-500",
  "bg-sky-500",
  "bg-amber-500",
  "bg-emerald-500",
  "bg-violet-500",
  "bg-orange-500",
  "bg-cyan-500",
  "bg-pink-500",
];
