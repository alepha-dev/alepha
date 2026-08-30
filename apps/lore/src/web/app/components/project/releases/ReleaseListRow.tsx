import { Badge } from "@alepha/ui/components/ui/badge";
import { DateTimeProvider } from "alepha/datetime";
import { useInject } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { ChevronRight } from "lucide-react";

import type { ReleaseResource } from "@/api/schemas/releaseResourceSchema.ts";
import type { I18n } from "@/web/app/services/I18n.ts";

export interface ReleaseListRowProps {
  release: ReleaseResource;
  onOpen: (tag: string) => void;
}

/**
 * One release in the list.
 *
 * An open row reads as a plan: tag, title, a bar of work done against work
 * attached, and the target date as a muted estimate. A released row reads as
 * a record: the date it went out and the counts frozen onto it, with no
 * estimate, because the estimate stopped meaning anything the moment it
 * shipped.
 */
const ReleaseListRow = (props: ReleaseListRowProps) => {
  const { release } = props;
  const { tr, l } = useI18n<I18n, "en">();
  const dt = useInject(DateTimeProvider);
  const published = !!release.releasedAt;
  const { completed, total } = release.progress;
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;

  // A release with no tag cannot be addressed at all: the tag IS the URL.
  // It should be unreachable (the create schema requires one) but the column
  // is nullable, so the row falls back to inert rather than to a broken link.
  const tag = release.tag;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => tag && props.onOpen(tag)}
      onKeyDown={(e) => {
        if (tag && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          props.onOpen(tag);
        }
      }}
      className="border-border hover:bg-muted/50 flex cursor-pointer items-center gap-3 rounded-lg border px-4 py-3 text-left transition-colors"
    >
      <Badge
        variant={published ? "outline" : "default"}
        className="shrink-0 font-mono"
      >
        {tag ?? `#${release.number}`}
      </Badge>

      <div className="min-w-0 flex-1">
        {/* Only when it says something the tag does not. `title` defaults to
            the tag server-side, so printing both would show it twice. */}
        {release.title !== tag && (
          <div className="truncate text-[13.5px] font-medium">
            {release.title}
          </div>
        )}
        <div className="text-muted-foreground text-[11.5px]">
          {published
            ? tr("release.list.releasedOn", {
                args: [String(l(release.releasedAt as string, { date: "ll" }))],
              })
            : release.targetDate
              ? tr("release.list.target", {
                  args: [
                    String(l(release.targetDate as string, { date: "ll" })),
                  ],
                })
              : tr("release.list.noTarget")}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <span className="bg-muted h-1.5 w-20 overflow-hidden rounded-full">
          <span
            className="block h-full rounded-full bg-green-600"
            style={{ width: `${pct}%` }}
          />
        </span>
        <span className="text-muted-foreground w-12 font-mono text-[11.5px]">
          {completed}/{total}
        </span>
      </div>

      <span className="text-muted-foreground w-16 shrink-0 text-right text-[11.5px]">
        {published ? dt.of(release.releasedAt as string).fromNow() : null}
      </span>

      <ChevronRight className="text-muted-foreground size-4 shrink-0" />
    </div>
  );
};

export default ReleaseListRow;
