import type { BucketStats, StorageStats } from "alepha/api/files";
import { useI18n } from "alepha/react/i18n";
import { useState } from "react";

import { Popover, PopoverContent, PopoverTrigger } from "../core/Popover.tsx";
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
 * split between buckets alone.
 *
 * ⚠️ **A segment opens a panel on CLICK, and the legend says nothing on
 * hover.** Both were tooltips. A tooltip cannot be read on a touch screen,
 * it says one sentence where the figures want rows, and two of them on the
 * same bucket (segment and legend) is the same text twice. The panel is a
 * `Popover`, not a `DropdownMenu`: its rows are figures to read, and a menu
 * item announces itself as something to activate. Hovering either half still
 * dims the other buckets, which is what pairs a segment with its legend
 * entry.
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

  /**
   * The accessible name of a segment: the bucket and its size, so the bar is
   * readable without opening anything. The panel's rows follow it.
   */
  const segmentLabel = (bucket: BucketStats) =>
    `${bucket.bucket}: ${formatBytes(bucket.totalSize)}`;

  const dim = (bucket: BucketStats) =>
    active !== undefined && active !== bucket.bucket && "opacity-30";

  /**
   * Dimming the other buckets, from either half. `onFocus`/`onBlur` keep it
   * for a keyboard walking the bar.
   */
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

      {/*
        Interactive, so NOT `aria-hidden`: each segment is a button naming its
        bucket and size, and the panel behind it holds the same figures the
        legend shows.
      */}
      <div className="bg-muted flex h-2.5 w-full overflow-hidden rounded-full">
        {buckets.map((bucket, index) => (
          <Popover key={bucket.bucket}>
            <PopoverTrigger
              render={
                <button
                  type="button"
                  data-bucket={bucket.bucket}
                  aria-label={segmentLabel(bucket)}
                  style={{ width: `${(bucket.totalSize / scale) * 100}%` }}
                  // A floor, so a bucket of a few kilobytes beside one of
                  // gigabytes is still there to click.
                  className={cn(
                    "focus-visible:ring-ring/50 h-full min-w-3 transition-opacity outline-none focus-visible:ring-[3px]",
                    BUCKET_COLORS[index % BUCKET_COLORS.length],
                    dim(bucket),
                  )}
                  {...hover(bucket)}
                />
              }
            />
            <PopoverContent className="w-60 p-0">
              <div className="flex items-center gap-2 px-3 py-2.5">
                <span
                  aria-hidden
                  className={cn(
                    "size-2 shrink-0 rounded-full",
                    BUCKET_COLORS[index % BUCKET_COLORS.length],
                  )}
                />
                <span className="flex-1 truncate font-medium">
                  {bucket.bucket}
                </span>
                <span className="font-mono text-xs tabular-nums">
                  {formatBytes(bucket.totalSize)}
                </span>
              </div>
              <dl className="border-t px-3 py-2 text-sm">
                <div className="flex items-baseline justify-between gap-3 py-0.5">
                  <dt className="text-muted-foreground">
                    {tr("admin.files.usageBucketFiles", { default: "Files" })}
                  </dt>
                  <dd className="tabular-nums">{l(bucket.fileCount)}</dd>
                </div>
                {hasQuota && (
                  <div className="flex items-baseline justify-between gap-3 py-0.5">
                    <dt className="text-muted-foreground">
                      {tr("admin.files.usageBucketShareQuota", {
                        default: "Share of quota",
                      })}
                    </dt>
                    <dd className="tabular-nums">
                      {percent(bucket.totalSize / stats.quota)}
                    </dd>
                  </div>
                )}
                <div className="flex items-baseline justify-between gap-3 py-0.5">
                  <dt className="text-muted-foreground">
                    {tr("admin.files.usageBucketShareUsed", {
                      default: "Share of used",
                    })}
                  </dt>
                  <dd className="tabular-nums">
                    {percent(bucket.totalSize / (stats.totalSize || 1))}
                  </dd>
                </div>
              </dl>
            </PopoverContent>
          </Popover>
        ))}
      </div>

      {/*
        The legend is text, not controls: what a tooltip on it used to say is
        one click away on the segment of the same colour, and an entry that
        opened the same panel would be a second trigger for one thing.
      */}
      <ul className="flex flex-wrap gap-x-4 gap-y-1.5">
        {buckets.map((bucket, index) => (
          <li
            key={bucket.bucket}
            className={cn(
              "flex items-center gap-1.5 text-sm transition-opacity",
              dim(bucket),
            )}
            {...hover(bucket)}
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
          </li>
        ))}
      </ul>
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
