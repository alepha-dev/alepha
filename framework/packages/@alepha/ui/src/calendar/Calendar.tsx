import { useI18n } from "alepha/react/i18n";
import { enUS, es, fr } from "date-fns/locale";
import {
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
} from "lucide-react";
import * as React from "react";
import {
  type DayButton,
  DayPicker,
  getDefaultClassNames,
  labelDayButton,
  type Locale,
} from "react-day-picker";

import { Button, buttonVariants } from "../core/Button.tsx";
import { cn } from "../core/utils.ts";

// Map Alepha's active language to a date-fns locale so month names and
// weekday headers render translated by default (consumers can still override
// via the `locale` prop). Unmapped languages fall back to react-day-picker's
// own default (en-US).
const LOCALE_BY_LANG: Record<string, Locale> = { fr, es, en: enUS };

export type CalendarProps = React.ComponentProps<typeof DayPicker> & {
  buttonVariant?: React.ComponentProps<typeof Button>["variant"];
};

const Calendar = (props: CalendarProps) => {
  const {
    className,
    classNames,
    showOutsideDays = true,
    captionLayout = "label",
    buttonVariant = "minimal",
    locale,
    formatters,
    components,
    labels,
    ...rest
  } = props;
  const defaultClassNames = getDefaultClassNames();
  const { lang, dir } = useI18n();
  const resolvedLocale = locale ?? LOCALE_BY_LANG[lang];

  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      className={cn(
        "group/calendar bg-background p-2 [--cell-radius:var(--radius-md)] [--cell-size:--spacing(7)] in-data-[slot=card-content]:bg-transparent in-data-[slot=popover-content]:bg-transparent",
        className,
      )}
      captionLayout={captionLayout}
      // The reading direction, unless the caller names one: react-day-picker
      // then swaps its previous / next chevrons and its arrow keys itself.
      dir={rest.dir ?? dir}
      locale={resolvedLocale}
      labels={{
        // The day's number first, then react-day-picker's own label: a
        // button whose name does not contain the text it shows fails WCAG
        // 2.5.3 (axe `label-content-name-mismatch`), and "1st" is not "1".
        labelDayButton: (date, modifiers, options, dateLib) =>
          `${date.getDate()}, ${labelDayButton(date, modifiers, options, dateLib)}`,
        ...labels,
      }}
      formatters={{
        formatMonthDropdown: (date) =>
          date.toLocaleString(resolvedLocale?.code, { month: "short" }),
        ...formatters,
      }}
      classNames={{
        root: cn("w-fit", defaultClassNames.root),
        months: cn(
          "relative flex flex-col gap-4 md:flex-row",
          defaultClassNames.months,
        ),
        month: cn("flex w-full flex-col gap-4", defaultClassNames.month),
        nav: cn(
          "absolute inset-x-0 top-0 flex w-full items-center justify-between gap-1",
          defaultClassNames.nav,
        ),
        button_previous: cn(
          buttonVariants({ variant: buttonVariant }),
          "size-(--cell-size) p-0 select-none aria-disabled:opacity-50",
          defaultClassNames.button_previous,
        ),
        button_next: cn(
          buttonVariants({ variant: buttonVariant }),
          "size-(--cell-size) p-0 select-none aria-disabled:opacity-50",
          defaultClassNames.button_next,
        ),
        month_caption: cn(
          "flex h-(--cell-size) w-full items-center justify-center px-(--cell-size)",
          defaultClassNames.month_caption,
        ),
        dropdowns: cn(
          "flex h-(--cell-size) w-full items-center justify-center gap-1.5 text-sm font-medium",
          defaultClassNames.dropdowns,
        ),
        dropdown_root: cn(
          "relative rounded-(--cell-radius)",
          defaultClassNames.dropdown_root,
        ),
        dropdown: cn(
          "bg-popover absolute inset-0 opacity-0",
          defaultClassNames.dropdown,
        ),
        caption_label: cn(
          "font-medium select-none",
          captionLayout === "label"
            ? "text-sm"
            : "[&>svg]:text-muted-foreground flex items-center gap-1 rounded-(--cell-radius) text-sm [&>svg]:size-3.5",
          defaultClassNames.caption_label,
        ),
        month_grid: cn("w-full border-collapse", defaultClassNames.month_grid),
        weekdays: cn("flex", defaultClassNames.weekdays),
        weekday: cn(
          "text-muted-foreground flex-1 rounded-(--cell-radius) text-[0.8rem] font-normal select-none",
          defaultClassNames.weekday,
        ),
        week: cn("mt-2 flex w-full", defaultClassNames.week),
        week_number_header: cn(
          "w-(--cell-size) select-none",
          defaultClassNames.week_number_header,
        ),
        week_number: cn(
          "text-muted-foreground text-[0.8rem] select-none",
          defaultClassNames.week_number,
        ),
        day: cn(
          "group/day relative aspect-square h-full w-full rounded-(--cell-radius) p-0 text-center select-none [&:last-child[data-selected=true]_button]:rounded-e-(--cell-radius)",
          rest.showWeekNumber
            ? "[&:nth-child(2)[data-selected=true]_button]:rounded-s-(--cell-radius)"
            : "[&:first-child[data-selected=true]_button]:rounded-s-(--cell-radius)",
          defaultClassNames.day,
        ),
        range_start: cn(
          "bg-muted after:bg-muted relative isolate z-0 rounded-s-(--cell-radius) after:absolute after:inset-y-0 after:end-0 after:w-4",
          defaultClassNames.range_start,
        ),
        range_middle: cn("rounded-none", defaultClassNames.range_middle),
        range_end: cn(
          "bg-muted after:bg-muted relative isolate z-0 rounded-e-(--cell-radius) after:absolute after:inset-y-0 after:start-0 after:w-4",
          defaultClassNames.range_end,
        ),
        // ⚠️ No fill. `bg-muted` here was the same fill a range endpoint
        // draws, so today read as a third picked day beside a two-day range
        // (feedback #P2203, #Q2334). The mark is the bar under the number,
        // drawn by `CalendarDayButton` from `data-today`.
        today: cn("text-foreground", defaultClassNames.today),
        outside: cn(
          "text-muted-foreground aria-selected:text-muted-foreground",
          defaultClassNames.outside,
        ),
        disabled: cn(
          "text-muted-foreground opacity-50",
          defaultClassNames.disabled,
        ),
        hidden: cn("invisible", defaultClassNames.hidden),
        ...classNames,
      }}
      components={{
        Root: ({ className, rootRef, ...props }) => {
          return (
            <div
              data-slot="calendar"
              ref={rootRef}
              className={cn(className)}
              {...props}
            />
          );
        },
        Chevron: ({ className, orientation, ...props }) => {
          if (orientation === "left") {
            return (
              <ChevronLeftIcon className={cn("size-4", className)} {...props} />
            );
          }

          if (orientation === "right") {
            return (
              <ChevronRightIcon
                className={cn("size-4", className)}
                {...props}
              />
            );
          }

          return (
            <ChevronDownIcon className={cn("size-4", className)} {...props} />
          );
        },
        DayButton: ({ ...props }) => (
          <CalendarDayButton locale={resolvedLocale} {...props} />
        ),
        WeekNumber: ({ children, ...props }) => {
          return (
            <td {...props}>
              <div className="flex size-(--cell-size) items-center justify-center text-center">
                {children}
              </div>
            </td>
          );
        },
        ...components,
      }}
      {...rest}
    />
  );
};

export type CalendarDayButtonProps = React.ComponentProps<typeof DayButton> & {
  locale?: Partial<Locale>;
};

const CalendarDayButton = (props: CalendarDayButtonProps) => {
  const { className, day, modifiers, locale, ...rest } = props;
  const defaultClassNames = getDefaultClassNames();

  const ref = React.useRef<HTMLButtonElement>(null);
  React.useEffect(() => {
    if (modifiers.focused) ref.current?.focus();
  }, [modifiers.focused]);

  return (
    <Button
      variant="minimal"
      size="icon"
      data-day={day.date.toLocaleDateString(locale?.code)}
      data-selected-single={
        modifiers.selected &&
        !modifiers.range_start &&
        !modifiers.range_end &&
        !modifiers.range_middle
      }
      data-range-start={modifiers.range_start}
      data-range-end={modifiers.range_end}
      data-range-middle={modifiers.range_middle}
      data-today={modifiers.today}
      className={cn(
        // Today is a short bar under the number, in the text's own colour:
        // a pseudo-element rather than `underline`, whose offset collides
        // with the edge of a 28px cell. `bg-current` keeps it visible on a
        // selected today (primary-foreground on primary) and a plain one.
        // Centred with a physical `left-1/2` on purpose: the same point in
        // either reading direction.
        "data-[today=true]:after:pointer-events-none data-[today=true]:after:absolute data-[today=true]:after:bottom-1 data-[today=true]:after:left-1/2 data-[today=true]:after:h-0.5 data-[today=true]:after:w-3 data-[today=true]:after:-translate-x-1/2 data-[today=true]:after:rounded-full data-[today=true]:after:bg-current",
        "group-data-[focused=true]/day:border-ring group-data-[focused=true]/day:ring-ring/50 data-[range-end=true]:bg-primary data-[range-end=true]:text-primary-foreground data-[range-middle=true]:bg-muted data-[range-middle=true]:text-foreground data-[range-start=true]:bg-primary data-[range-start=true]:text-primary-foreground data-[selected-single=true]:bg-primary data-[selected-single=true]:text-primary-foreground dark:hover:text-foreground relative isolate z-10 flex aspect-square size-auto w-full min-w-(--cell-size) flex-col gap-1 border-0 leading-none font-normal group-data-[focused=true]/day:relative group-data-[focused=true]/day:z-10 group-data-[focused=true]/day:ring-[3px] data-[range-end=true]:rounded-(--cell-radius) data-[range-end=true]:rounded-e-(--cell-radius) data-[range-middle=true]:rounded-none data-[range-start=true]:rounded-(--cell-radius) data-[range-start=true]:rounded-s-(--cell-radius) [&>span]:text-xs [&>span]:opacity-70",
        defaultClassNames.day,
        className,
      )}
      {...rest}
    />
  );
};

export { Calendar, CalendarDayButton };
