import type { BucketStats, StorageStats } from "alepha/api/files";
import { useI18n } from "alepha/react/i18n";
import { useState } from "react";

import { Popover, PopoverContent, PopoverTrigger } from "../core/Popover.tsx";
import { Segmented } from "../core/Segmented.tsx";
import { cn, formatBytes } from "../core/utils.ts";
import {
  readPersisted,
  writePersisted,
} from "../table/dataTablePersistence.ts";

export interface AdminFilesUsageCardProps {
  stats: StorageStats;
  /**
   * Where the bar's mode is remembered: the table's own `persistenceKey`,
   * beside its summary panel's open state. Without one the mode lasts as
   * long as the card.
   */
  persistenceKey?: string;
}

/**
 * What the bar is drawn against: the quota (its empty track is the free
 * space) or the used total alone (the segments fill it and are each
 * bucket's share).
 */
export type AdminFilesUsageMode = "quota" | "share";

/**
 * The storage of every bucket in one tile: what is used, out of what quota,
 * a bar split by bucket, and a legend of the buckets with their sizes.
 *
 * With a quota the bar is drawn against it, so its empty track is the free
 * space. Without one there is nothing to be a share of, and the bar is the
 * split between buckets alone.
 *
 * ⚠️ **A legend entry opens a panel on CLICK; the bar is decorative.**
 * Both were tooltips, then the segments were the triggers: a tooltip cannot
 * be read on a touch screen, and a small bucket's segment was a 12x10 px
 * target (#Q3488). The panel is a `Popover`, not a `DropdownMenu`: its rows
 * are figures to read, and a menu item announces itself as something to
 * activate. Hovering either half still dims the other buckets, which is what
 * pairs a segment with its legend entry.
 */
export const AdminFilesUsageCard = (props: AdminFilesUsageCardProps) => {
  const { stats, persistenceKey } = props;
  const { l, tr } = useI18n();
  const [active, setActive] = useState<string | undefined>();
  const [mode, setMode] = useState<AdminFilesUsageMode>(() =>
    persistenceKey &&
    readPersisted<unknown>(persistenceKey, "usageMode") === "share"
      ? "share"
      : "quota",
  );
  const changeMode = (next: string) => {
    const value: AdminFilesUsageMode = next === "share" ? "share" : "quota";
    setMode(value);
    if (persistenceKey) {
      writePersisted(persistenceKey, "usageMode", value);
    }
  };

  const buckets = [...stats.byBucket].sort((a, b) => b.totalSize - a.totalSize);
  const hasQuota = stats.quota > 0;
  // With 1.5% of the quota used, the bar against the quota is a sliver. The
  // share mode draws it against the used total instead, so the split between
  // buckets is readable. Without a quota there is only that mode.
  const ofQuota = hasQuota && mode === "quota";
  // `max` rather than the quota alone: a quota lowered below what is already
  // stored would otherwise draw segments past the end of the bar.
  const scale =
    (ofQuota ? Math.max(stats.quota, stats.totalSize) : stats.totalSize) || 1;
  const percent = (ratio: number) =>
    l(ratio, { number: { style: "percent", maximumFractionDigits: 1 } });

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
        {hasQuota && (
          <Segmented
            size="xs"
            className="order-last ms-auto self-start"
            aria-label={tr("admin.files.usageMode", { default: "Bar" })}
            value={mode}
            onChange={changeMode}
            options={[
              {
                value: "quota",
                label: tr("admin.files.usageModeQuota", {
                  default: "Of quota",
                }),
              },
              {
                value: "share",
                label: tr("admin.files.usageModeShare", {
                  default: "Share",
                }),
              },
            ]}
          />
        )}
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
                count: stats.totalFiles,
                default: {
                  one: "{count} file, no quota",
                  other: "{count} files, no quota",
                },
              })}
        </span>
      </div>

      {/*
        Decorative: the bar repeats what the legend says. Its segments were
        the panel's triggers, and a small bucket drew a 12x10 px button, under
        the 24x24 px target WCAG 2.5.8 asks (#Q3488). Hovering a segment
        still picks its bucket out in the legend.
      */}
      <div
        aria-hidden
        className="bg-muted flex h-2.5 w-full overflow-hidden rounded-full"
      >
        {buckets.map((bucket, index) => (
          <div
            key={bucket.bucket}
            data-bucket={bucket.bucket}
            style={{ width: `${(bucket.totalSize / scale) * 100}%` }}
            // A floor, so a bucket of a few kilobytes beside one of
            // gigabytes still shows.
            className={cn(
              "h-full min-w-3 transition-opacity",
              BUCKET_COLORS[index % BUCKET_COLORS.length],
              dim(bucket),
            )}
            onMouseEnter={() => setActive(bucket.bucket)}
            onMouseLeave={() => setActive(undefined)}
          />
        ))}
      </div>

      {/*
        The legend holds the controls: each entry is a button at least 24 px
        tall, named by its own visible text (the bucket and its size, no
        `aria-label` to drift from it, WCAG 2.5.3), and it opens the panel of
        that bucket's figures.
      */}
      <ul className="flex flex-wrap gap-x-4 gap-y-1">
        {buckets.map((bucket, index) => (
          <li
            key={bucket.bucket}
            className={cn("flex transition-opacity", dim(bucket))}
          >
            <Popover>
              <PopoverTrigger
                render={
                  <button
                    type="button"
                    data-legend-bucket={bucket.bucket}
                    className="focus-visible:ring-ring/50 hover:bg-muted -mx-1 flex min-h-6 items-center gap-1.5 rounded-sm px-1 text-sm outline-none focus-visible:ring-[3px]"
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
                {!ofQuota && (
                  <span
                    data-testid="usage-share"
                    className="text-muted-foreground text-xs tabular-nums"
                  >
                    {percent(bucket.totalSize / (stats.totalSize || 1))}
                  </span>
                )}
              </PopoverTrigger>
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
