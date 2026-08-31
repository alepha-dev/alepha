import { useI18n } from "alepha/react/i18n";
import { useEffect, useRef, useState } from "react";

import type { I18n } from "@/web/app/services/I18n.ts";

import {
  BUCKET_FILL,
  BUCKET_LABEL_KEYS,
  BUCKET_ORDER,
  type ReleaseBucket,
  type ReleaseBuckets,
} from "./releaseBuckets.ts";

/**
 * How long the pointer has to rest on a segment before it names itself.
 *
 * 550ms is the whole design of this control. Long enough that sweeping the
 * pointer across the bar on the way somewhere else shows nothing, short
 * enough that stopping on a segment feels answered rather than laggy. Do not
 * lower it to 0, and do not reach for `title=` instead: that is ~1s,
 * unthemeable, and reads as a browser artifact rather than part of the page.
 */
const HOVER_DELAY_MS = 550;

export interface ReleaseProgressBarProps {
  buckets: ReleaseBuckets;
}

/**
 * The release rollup as four proportional segments.
 *
 * Not `@alepha/ui`'s `Progress`, which renders one bar: the four buckets are
 * the point, and one filled fraction cannot separate work in flight from work
 * nobody has picked up, nor either of those from work that was declined.
 *
 * **There is no legend.** An earlier draft printed `7 done · 3 in progress ·
 * 3 open · 2 shelved` underneath, which repeated the ratio beside it and made
 * the plate's densest corner its noisiest. The tooltip replaced it, which is
 * what makes the tooltip load-bearing rather than a nicety - and why every
 * segment carries its own count, label and share rather than just a name.
 *
 * The bar is `aria-hidden` and the same four numbers are given to a screen
 * reader as one sentence on the wrapper: a hover-only affordance is not a
 * place to keep facts that exist nowhere else.
 */
const ReleaseProgressBar = (props: ReleaseProgressBarProps) => {
  const { tr } = useI18n<I18n, "en">();
  const { buckets } = props;

  const [hovered, setHovered] = useState<ReleaseBucket | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clear = () => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  };

  // A timer that outlives its component fires `setState` on an unmounted
  // tree. Cleared on unmount, not merely on leave: navigating away with the
  // pointer resting on a segment never produces a leave event.
  useEffect(() => clear, []);

  const enter = (bucket: ReleaseBucket) => {
    clear();
    // Already open means the reader has waited once and is now reading along
    // the bar. Making them wait again for each neighbour turns one gesture
    // into four separate ones.
    if (hovered) {
      setHovered(bucket);
      return;
    }
    timer.current = setTimeout(() => setHovered(bucket), HOVER_DELAY_MS);
  };

  // On the BAR, not the segment: the gaps between segments are part of the
  // bar, and hiding on each segment's leave would flicker the tooltip closed
  // and open again every time the pointer crossed one.
  const leave = () => {
    clear();
    setHovered(null);
  };

  const shown = BUCKET_ORDER.filter((bucket) => buckets[bucket] > 0);

  const share = (bucket: ReleaseBucket) =>
    // Shelved work is outside `total`, so a percentage of it would be a
    // fraction of a denominator this quest is not in. It says so instead.
    bucket === "shelved"
      ? tr("release.bucket.outside", { args: [String(buckets.total)] })
      : tr("release.bucket.share", {
          args: [
            String(
              buckets.total > 0
                ? Math.round((buckets[bucket] / buckets.total) * 100)
                : 0,
            ),
            String(buckets.total),
          ],
        });

  return (
    <div className="relative">
      <div className="flex h-2 gap-0.5" onMouseLeave={leave}>
        {shown.map((bucket) => (
          // A real button, not a decorated span. These four numbers exist
          // nowhere else on the page now that the legend is gone, so leaving
          // them behind a hover would put them out of reach of a keyboard
          // entirely - and the `aria-label` is the same sentence the tooltip
          // renders. Focus opens it with NO delay: unlike a pointer crossing
          // the bar on its way elsewhere, focus is already a choice.
          <button
            key={bucket}
            type="button"
            aria-label={`${buckets[bucket]} ${String(
              tr(BUCKET_LABEL_KEYS[bucket]),
            )}, ${String(share(bucket))}`}
            // `flex: {count}` rather than a percentage width: the segments
            // then divide the track between themselves and cannot fail to
            // add up to it, whatever the counts are.
            style={{ flex: buckets[bucket] }}
            // A gap wide enough to read as a break rather than a seam, and
            // only before the declined segment. It is the visual half of
            // "shelved is outside the total": the three buckets left of the
            // gap are the release, the one on the right is what was dropped
            // from it.
            className={`rounded-[1px] ${BUCKET_FILL[bucket]} ${
              bucket === "shelved" ? "ml-1.5" : ""
            }`}
            onMouseEnter={() => enter(bucket)}
            onFocus={() => {
              clear();
              setHovered(bucket);
            }}
            onBlur={leave}
          />
        ))}
      </div>

      {hovered && (
        <div className="bg-muted border-border text-foreground pointer-events-none absolute bottom-4 left-0 z-20 inline-flex items-center gap-[7px] rounded-[7px] border px-[9px] py-[5px] text-[11.5px] whitespace-nowrap shadow-md">
          <span className="font-mono font-semibold">{buckets[hovered]}</span>
          <span>{tr(BUCKET_LABEL_KEYS[hovered])}</span>
          <span className="text-muted-foreground">{share(hovered)}</span>
        </div>
      )}
    </div>
  );
};

export default ReleaseProgressBar;
