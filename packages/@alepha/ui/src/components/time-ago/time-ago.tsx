import type { DateTime } from "alepha/datetime";
import { ClientOnly } from "alepha/react";
import { useI18n } from "alepha/react/i18n";

export interface TimeAgoProps {
  /**
   * The instant. The same set `useI18n().l()` takes, `DateTime` included -
   * `DateTimeProvider.now()` returns one, so a narrower type here would make
   * the component unusable from exactly the place that owns the clock.
   */
  value: string | number | Date | DateTime;

  /**
   * The exact form, shown on hover and rendered on the server.
   *
   * ⚠️ A dayjs format string, not an `Intl` options bag.
   * `I18nLocalizeOptions` has `date` and `number` only - there is no `time` -
   * so `lll` is how a date AND a time are asked for.
   */
  format?: string;

  className?: string;
}

/**
 * An instant, read as "2 hours ago", with the exact datetime on hover.
 *
 * ## Why a component and not a fifth spelling
 *
 * There were four ways to write this - `dt.of(x).fromNow()`,
 * `dateFormatter.of(x).fromNow()`, `l(x, { date: "fromNow" })` and
 * `<Localize value={x} date="fromNow" />` - and **none of them carried the
 * exact date**. A tooltip added by hand is a tooltip added to some call sites
 * and forgotten on the rest, which is what the Apps table's Last seen column
 * demonstrated by rendering four rows of `Sep 9, 2026 7:00 PM` and making the
 * reader subtract dates to see whether a copy was alive (feedback #P2174).
 *
 * ## ⚠️ The SSR guard is built in, and that is the point
 *
 * A `fromNow()` string is computed from the clock, so it differs between the
 * server render and hydration and trips React #418. Before this component
 * there were 11 `ClientOnly` guards against 42 relative-time call sites: most
 * were simply unguarded. Putting the guard inside means the next call site
 * cannot forget it.
 *
 * The server renders the EXACT datetime rather than nothing. A crawler, a
 * reader with no JavaScript and the first paint all get a true answer instead
 * of a blank, which matters on `/:projectSlug/roadmap` - the one page Lore
 * server-renders for an audience that may never run the client. The visible
 * swap on hydration is the price, and it is a swap from correct to more
 * readable.
 *
 * ## Where NOT to use it
 *
 * A date somebody CHOSE, rather than one that happened: a release target
 * date, a quest due date. "in 3 months" is not a deadline anyone can plan
 * against, and the relative form actively destroys the information. Relative
 * time is for events - created, updated, last seen, last reported - where the
 * question is "how stale is this" and the answer is the gap, not the date.
 */
const TimeAgo = (props: TimeAgoProps) => {
  const { l } = useI18n();
  const exact = String(l(props.value, { date: props.format ?? "lll" }));

  return (
    <ClientOnly
      fallback={
        <span className={props.className} title={exact}>
          {exact}
        </span>
      }
    >
      <span className={props.className} title={exact}>
        {String(l(props.value, { date: "fromNow" }))}
      </span>
    </ClientOnly>
  );
};

export default TimeAgo;
