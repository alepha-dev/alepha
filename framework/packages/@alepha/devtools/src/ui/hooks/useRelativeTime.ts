import { DateTimeProvider } from "alepha/datetime";
import { useInject } from "alepha/react";
import { useEffect, useState } from "react";

export interface RelativeTimeOptions {
  /**
   * What to print when there is no usable instant: no value at all, or a
   * string the date parser rejected. Views disagree on the right word —
   * a job that never ran reads "never", an outbox row with a broken stamp
   * reads "unknown" — so the caller names it.
   */
  fallback?: string;
}

/**
 * A "3 minutes ago" formatter that stays true as you watch it.
 *
 * Five views each carried their own copy of this arithmetic, read off the
 * ambient wall clock, which broke the two rules that matter here: the clock
 * has to come from {@link DateTimeProvider} so tests can travel it, and a
 * label that claims to be relative has to move. A devtools tab is left open
 * for minutes at a time, so "just now" would otherwise still be on screen an
 * hour later.
 *
 * It is a formatter rather than `useRelativeTime(date)` because every call
 * site prints one label per row inside a `map`, where a hook per date is not
 * something the rules of hooks allow.
 *
 * The scale stops at minutes on purpose: the component re-renders once a
 * minute, so a seconds-precision label would be a number that is wrong for
 * fifty-nine seconds out of every sixty.
 */
export const useRelativeTime = (options: RelativeTimeOptions = {}) => {
  const dateTime = useInject(DateTimeProvider);
  const [, setTick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  const fallback = options.fallback ?? "—";

  return (value?: string | number | null): string => {
    if (value === undefined || value === null || value === "") return fallback;
    const at = typeof value === "number" ? value : Date.parse(value);
    if (Number.isNaN(at)) return fallback;

    const diff = dateTime.nowMillis() - at;
    if (diff < 60_000) return "just now";
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
    // The capture directory is not cleared between runs, so it accumulates for
    // as long as the checkout lives. Without a day bucket a week-old message
    // read "170h ago", which is arithmetic rather than an answer.
    return `${Math.floor(diff / 86_400_000)}d ago`;
  };
};
