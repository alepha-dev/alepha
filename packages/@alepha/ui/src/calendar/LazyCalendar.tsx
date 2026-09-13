import { type ComponentProps, lazy, Suspense } from "react";

import type { Calendar } from "./Calendar.tsx";

export type LazyCalendarProps = ComponentProps<typeof Calendar>;

/**
 * The one `import()` of the calendar chunk, shared by the preload and the
 * lazy component so the chunk is requested once whichever asks first.
 *
 * Forgotten again on failure: a rejected promise kept here would make a
 * dropped connection permanent for the page's lifetime, where the next hover
 * could simply have tried again.
 */
let calendarChunk: Promise<typeof import("./Calendar.tsx")> | undefined;

const loadCalendar = (): Promise<typeof import("./Calendar.tsx")> => {
  calendarChunk ??= import("./Calendar.tsx").catch((error: unknown) => {
    calendarChunk = undefined;
    throw error;
  });
  return calendarChunk;
};

/**
 * Start downloading the calendar before it is needed.
 *
 * The date triggers call this on `pointerenter` and `focus`, so by the time
 * the click lands and the popover opens the chunk is usually already there.
 * Safe to call any number of times. A failed download is swallowed here and
 * forgotten: the render that needs the calendar asks again, and that is where
 * an error belongs.
 */
export const preloadCalendar = (): void => {
  loadCalendar().catch(() => {});
};

const CalendarChunk = lazy(() =>
  loadCalendar().then((chunk) => ({ default: chunk.Calendar })),
);

/**
 * `Calendar`, loaded when it first renders instead of with the form.
 *
 * `Control` dispatches on a field's schema at runtime, so a bundler can never
 * drop the date branch: before this, every form shipped react-day-picker and
 * date-fns, date field or not. The date controls only ever render a calendar
 * inside an OPEN popover, so this boundary is never met on the server (a
 * closed popover renders no content) and the triggers, which carry the
 * control's value, still render synchronously.
 *
 * ⚠️ The fallback is the calendar's own box, not a spinner: the caption row,
 * the weekday row and five weeks, on the same `--cell-size` and padding the
 * calendar uses, so the popup does not jump when the chunk arrives. A
 * six-week month grows by one row once loaded, as it would when paging to it.
 */
export const LazyCalendar = (props: LazyCalendarProps) => {
  return (
    <Suspense
      fallback={
        <div
          data-slot="calendar-fallback"
          aria-busy="true"
          className="p-2 [--cell-size:--spacing(7)]"
        >
          <div className="flex w-[calc(var(--cell-size)*7)] flex-col gap-4">
            <div className="h-(--cell-size)" />
            <div>
              <div className="text-[0.8rem]">&nbsp;</div>
              {[0, 1, 2, 3, 4].map((week) => (
                <div key={week} className="mt-2 h-(--cell-size)" />
              ))}
            </div>
          </div>
        </div>
      }
    >
      <CalendarChunk {...props} />
    </Suspense>
  );
};
