import { useI18n } from "alepha/react/i18n";

import type { ReleaseResource } from "@/api/schemas/releaseResourceSchema.ts";
import type { I18n } from "@/web/app/services/I18n.ts";

export interface ReleaseProgressProps {
  release: ReleaseResource;
}

/**
 * The Progress cell of the Releases list: work done against work attached.
 *
 * Carried over from `ReleaseListRow`, which the table replaced, rather than
 * modelled on the Epics tick bar. The two counts mean different things: an
 * epic's bar is one tick per quest across four disjoint buckets, while a
 * release's rollup is completed against total, and drawing it as ticks would
 * imply a breakdown the resource does not carry.
 *
 * A released row still shows its bar. The counts froze on publish, which is
 * exactly why they are worth reading: they are the record of what shipped.
 */
const ReleaseProgress = (props: ReleaseProgressProps) => {
  const { tr } = useI18n<I18n, "en">();
  const { completed, total } = props.release.progress;

  if (total === 0) {
    return (
      <span className="text-muted-foreground text-xs">
        {tr("release.progress.none")}
      </span>
    );
  }

  const pct = Math.round((completed / total) * 100);

  return (
    <div className="flex min-w-40 items-center gap-2">
      <span className="bg-muted h-1.5 flex-1 overflow-hidden rounded-full">
        <span
          className="bg-primary block h-full rounded-full"
          style={{ width: `${pct}%` }}
        />
      </span>
      <span className="text-muted-foreground w-12 shrink-0 font-mono text-[11.5px]">
        {completed}/{total}
      </span>
    </div>
  );
};

export default ReleaseProgress;
