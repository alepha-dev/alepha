import {
  Button,
  cn,
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@alepha/ui";
import type { I18n } from "@lore/core/web";
import { DateTimeProvider } from "alepha/datetime";
import { useInject } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import {
  type KeyboardEvent,
  type ReactElement,
  useMemo,
  useRef,
  useState,
} from "react";

import type { FolioColumnResource } from "../../../../../../../api/schemas/folioColumnResourceSchema.ts";
import type { FolioRowResource } from "../../../../../../../api/schemas/folioRowResourceSchema.ts";
import { folioCellText } from "../folioTableModel.ts";
import {
  folioCellTime,
  folioDayKey,
  folioMonthWeeks,
  folioRowsByDay,
  folioShiftMonth,
  folioWeekStart,
} from "./folioCalendarModel.ts";

export interface FolioTableCalendarProps {
  columns: FolioColumnResource[];
  /**
   * The rows to lay out, already filtered by the reader's find text.
   */
  rows: FolioRowResource[];
  dateColumnId: string;
  titleColumnId?: string;
  readOnly: boolean;
  writing?: boolean;
  /**
   * The month shown, `YYYY-MM`, kept in the URL by the document.
   */
  month: string;
  onMonth: (month: string) => void;
  onOpenRow: (row: FolioRowResource) => void;
  onAddOnDay: (day: string) => void;
  onMoveToDay: (row: FolioRowResource, day: string) => void;
  /**
   * Today, `YYYY-MM-DD`: passed in so a spec can fix it.
   */
  today?: string;
}

/**
 * A table read as a month (#E144, #Q3518): a view of the table, not a folio
 * type. A row is an entry on the day its date column holds, titled by the
 * title column; a date with a time shows the time in the reader's zone, a
 * day-only date never shifts. A day with more entries than fit shows
 * "+N more".
 *
 * Click an entry to edit its row, click a day to add a row on it, drag an
 * entry to another day to move it (one row update with its version). Arrows
 * move between days, Enter opens the day. Rows without a date are listed
 * under the month, so nothing disappears by switching views. At a phone's
 * width the month is an agenda list by day.
 *
 * A lazy chunk: `@alepha/ui`'s `Calendar` is a date picker, not an event
 * grid, so this is built from the kit's primitives.
 */
const FolioTableCalendar = (props: FolioTableCalendarProps): ReactElement => {
  const { tr, lang } = useI18n<I18n, "en">();
  const locale = String(lang ?? "en");
  const dateTime = useInject(DateTimeProvider);
  const today = props.today ?? folioDayKey(new Date(dateTime.nowMillis()));
  const weekStart = folioWeekStart(locale);
  const weeks = useMemo(
    () => folioMonthWeeks(props.month, weekStart),
    [props.month, weekStart],
  );
  const { byDay, undated } = useMemo(
    () => folioRowsByDay(props.rows, props.dateColumnId),
    [props.rows, props.dateColumnId],
  );
  const titleColumn = props.columns.find((c) => c.id === props.titleColumnId);
  const [focusDay, setFocusDay] = useState<string>(
    today.startsWith(props.month) ? today : `${props.month}-01`,
  );
  const [openDay, setOpenDay] = useState<string | undefined>(undefined);
  const [dragging, setDragging] = useState<number | undefined>(undefined);
  const gridRef = useRef<HTMLDivElement>(null);
  const perDay = 3;

  const titleOf = (row: FolioRowResource): string => {
    const text = titleColumn
      ? folioCellText(titleColumn, row.cells[titleColumn.id] ?? null)
      : "";
    return text || tr("folios.table.row.menu", { args: [String(row.number)] });
  };

  const dayLabel = (day: string, style: "long" | "short" = "long") => {
    const [y, m, d] = day.split("-").map(Number);
    return new Date(y, m - 1, d).toLocaleDateString(locale, {
      weekday: style,
      day: "numeric",
      month: style,
      ...(style === "long" ? { year: "numeric" } : {}),
    });
  };

  const monthLabel = (() => {
    const [y, m] = props.month.split("-").map(Number);
    return new Date(y, m - 1, 1).toLocaleDateString(locale, {
      month: "long",
      year: "numeric",
    });
  })();

  const weekdayLabels = weeks[0].map((day) => {
    const [y, m, d] = day.split("-").map(Number);
    return new Date(y, m - 1, d).toLocaleDateString(locale, {
      weekday: "short",
    });
  });

  const moveFocus = (by: number) => {
    const [y, m, d] = focusDay.split("-").map(Number);
    const next = folioDayKey(new Date(y, m - 1, d + by));
    setFocusDay(next);
    if (!next.startsWith(props.month)) props.onMonth(next.slice(0, 7));
    requestAnimationFrame(() =>
      gridRef.current
        ?.querySelector<HTMLElement>(`[data-day="${next}"]`)
        ?.focus(),
    );
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const moves: Record<string, number> = {
      ArrowLeft: -1,
      ArrowRight: 1,
      ArrowUp: -7,
      ArrowDown: 7,
    };
    const by = moves[event.key];
    if (by !== undefined) {
      event.preventDefault();
      moveFocus(by);
    } else if (event.key === "Enter") {
      event.preventDefault();
      setOpenDay(focusDay);
    }
  };

  const entry = (row: FolioRowResource, compact = true) => {
    const time = folioCellTime(row.cells[props.dateColumnId], locale);
    return (
      <button
        key={row.id}
        type="button"
        draggable={!props.readOnly}
        data-row-number={row.number}
        onDragStart={(event) => {
          event.stopPropagation();
          event.dataTransfer.effectAllowed = "move";
          setDragging(row.number);
        }}
        onDragEnd={() => setDragging(undefined)}
        onClick={(event) => {
          event.stopPropagation();
          props.onOpenRow(row);
        }}
        className={cn(
          "bg-primary/10 hover:bg-primary/20 text-foreground flex w-full min-w-0 items-center gap-1 rounded px-1.5 text-start text-xs",
          compact ? "h-5" : "h-8 text-sm",
          dragging === row.number && "opacity-50",
        )}
      >
        {time && (
          <span className="text-muted-foreground shrink-0 tabular-nums">
            {time}
          </span>
        )}
        <span className="truncate">{titleOf(row)}</span>
      </button>
    );
  };

  const openRows = openDay ? (byDay.get(openDay) ?? []) : [];

  return (
    <div data-slot="folio-calendar" className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Button
          variant="minimal"
          size="icon-sm"
          aria-label={tr("folios.table.calendar.previous")}
          onClick={() => props.onMonth(folioShiftMonth(props.month, -1))}
        >
          <ChevronLeft className="size-4 rtl:rotate-180" />
        </Button>
        <h2 className="min-w-40 text-center text-sm font-semibold capitalize">
          {monthLabel}
        </h2>
        <Button
          variant="minimal"
          size="icon-sm"
          aria-label={tr("folios.table.calendar.next")}
          onClick={() => props.onMonth(folioShiftMonth(props.month, 1))}
        >
          <ChevronRight className="size-4 rtl:rotate-180" />
        </Button>
        <Button
          variant="outlined"
          size="sm"
          onClick={() => {
            props.onMonth(today.slice(0, 7));
            setFocusDay(today);
          }}
        >
          {tr("folios.table.calendar.today")}
        </Button>
      </div>

      {/* The month, from a tablet's width up. */}
      <div
        ref={gridRef}
        role="grid"
        tabIndex={-1}
        aria-label={monthLabel}
        className="border-border hidden overflow-hidden rounded-md border sm:block"
        onKeyDown={onKeyDown}
      >
        <div role="row" className="bg-muted/40 grid grid-cols-7 text-xs">
          {weekdayLabels.map((label) => (
            <div
              key={label}
              role="columnheader"
              className="text-muted-foreground px-2 py-1 font-medium capitalize"
            >
              {label}
            </div>
          ))}
        </div>
        {weeks.map((week) => (
          <div key={week[0]} role="row" className="grid grid-cols-7">
            {week.map((day) => {
              const entries = byDay.get(day) ?? [];
              const outside = !day.startsWith(props.month);
              const more = entries.length - perDay;
              return (
                // A day: the grid's keyboard handler drives it, a click adds
                // a row on it.
                // oxlint-disable-next-line jsx-a11y/click-events-have-key-events
                <div
                  key={day}
                  role="gridcell"
                  data-day={day}
                  tabIndex={day === focusDay ? 0 : -1}
                  aria-label={`${dayLabel(day)}, ${tr("folios.table.calendar.entries", { args: [String(entries.length)] })}`}
                  aria-current={day === today ? "date" : undefined}
                  className={cn(
                    "border-border focus-visible:ring-ring flex min-h-24 flex-col gap-0.5 border-s border-t p-1 outline-none first:border-s-0 focus-visible:ring-2 focus-visible:ring-inset",
                    outside && "bg-muted/20 text-muted-foreground",
                    !props.readOnly && "cursor-pointer",
                  )}
                  onFocus={() => setFocusDay(day)}
                  onClick={() => {
                    if (!props.readOnly && !props.writing)
                      props.onAddOnDay(day);
                  }}
                  onDragOver={(event) => {
                    if (dragging !== undefined) event.preventDefault();
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    const row = props.rows.find((it) => it.number === dragging);
                    setDragging(undefined);
                    if (row) props.onMoveToDay(row, day);
                  }}
                >
                  <span
                    className={cn(
                      "self-end px-1 text-xs tabular-nums",
                      day === today &&
                        "bg-primary text-primary-foreground rounded-full",
                    )}
                  >
                    {Number(day.slice(8))}
                  </span>
                  {entries
                    .slice(0, more > 0 ? perDay - 1 : perDay)
                    .map((row) => entry(row))}
                  {more > 0 && (
                    <button
                      type="button"
                      className="text-muted-foreground hover:text-foreground px-1.5 text-start text-xs"
                      onClick={(event) => {
                        event.stopPropagation();
                        setOpenDay(day);
                      }}
                    >
                      {tr("folios.table.calendar.more", {
                        args: [String(more + 1)],
                      })}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>

      {/* The agenda, at a phone's width: the month's days that hold rows. */}
      <div data-slot="folio-agenda" className="flex flex-col gap-3 sm:hidden">
        {weeks
          .flat()
          .filter((day) => day.startsWith(props.month) && byDay.has(day))
          .map((day) => (
            <section key={day} className="flex flex-col gap-1">
              <h3
                className={cn(
                  "text-xs font-semibold",
                  day === today && "text-primary",
                )}
              >
                {dayLabel(day)}
              </h3>
              {(byDay.get(day) ?? []).map((row) => entry(row, false))}
            </section>
          ))}
      </div>

      {undated.length > 0 && (
        <section className="flex flex-col gap-1">
          <h3 className="text-muted-foreground text-xs font-semibold">
            {tr("folios.table.calendar.no-date", {
              args: [String(undated.length)],
            })}
          </h3>
          <div className="grid gap-1 sm:grid-cols-3">
            {undated.map((row) => entry(row, false))}
          </div>
        </section>
      )}

      <Sheet
        open={openDay !== undefined}
        onOpenChange={(open) => {
          if (!open) setOpenDay(undefined);
        }}
      >
        <SheetContent side="right" className="w-[min(92vw,24rem)]">
          <SheetHeader>
            <SheetTitle className="capitalize">
              {openDay ? dayLabel(openDay) : ""}
            </SheetTitle>
          </SheetHeader>
          <div className="flex flex-col gap-1 px-4 pb-6">
            {openRows.length === 0 && (
              <p className="text-muted-foreground text-sm">
                {tr("folios.table.calendar.empty-day")}
              </p>
            )}
            {openRows.map((row) => entry(row, false))}
            {!props.readOnly && openDay && (
              <Button
                size="sm"
                className="mt-2 self-start"
                disabled={props.writing}
                onClick={() => {
                  props.onAddOnDay(openDay);
                  setOpenDay(undefined);
                }}
              >
                <Plus className="size-3.5" />
                {tr("folios.table.calendar.add-on-day")}
              </Button>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
};

export default FolioTableCalendar;
