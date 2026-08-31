import { BUCKET_FILL, type ReleaseBucket } from "./releaseBuckets.ts";

/**
 * Widest bar drawn. Past this the ticks are downsampled rather than grown:
 * one tick per quest is legible for the epics people actually write, and a
 * 200-quest epic would otherwise render 200 sub-pixel slivers.
 */
const MAX_TICKS = 24;

export interface ReleaseTickBarProps {
  /**
   * One entry per quest, in the order they should be drawn.
   */
  buckets: ReleaseBucket[];
}

/**
 * One tick per quest, in an epic card's header.
 *
 * The plate's bar is proportional because a release can hold a hundred
 * quests; an epic holds a handful, so one tick each is both legible and
 * exact - and a reader can literally count what is left.
 *
 * Takes the ticks already built from the ROWS the card renders, rather than
 * four counts. That is the point: a card cannot print a ratio the list below
 * it disagrees with if both are the same array.
 */
const ReleaseTickBar = (props: ReleaseTickBarProps) => {
  const ticks =
    props.buckets.length <= MAX_TICKS
      ? props.buckets
      : // Downsampling the expanded array rather than rounding each bucket to
        // a tick count keeps the segments proportional without the rounding
        // drift that makes four percentages fail to add up to the width.
        Array.from(
          { length: MAX_TICKS },
          (_, i) =>
            props.buckets[Math.floor((i * props.buckets.length) / MAX_TICKS)],
        );

  return (
    <span className="flex w-30 shrink-0 gap-0.5" aria-hidden>
      {ticks.map((bucket, index) => (
        <span
          key={index}
          className={`h-1.5 flex-1 rounded-[1px] ${BUCKET_FILL[bucket]}`}
        />
      ))}
    </span>
  );
};

export default ReleaseTickBar;
