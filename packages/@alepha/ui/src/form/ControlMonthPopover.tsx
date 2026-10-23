import * as React from "react";

void React;

import { useI18n } from "alepha/react/i18n";
import {
  CalendarDays as CalendarIcon,
  ChevronDown as ChevronDownIcon,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { type HTMLAttributes, useState } from "react";

import { Button } from "../core/Button.tsx";
import { Popover, PopoverContent, PopoverTrigger } from "../core/Popover.tsx";
import { cn } from "../core/utils.ts";
import {
  ControlClearButton,
  TRIGGER_CLASSES,
  TRIGGER_SIZES,
  TRIGGER_WRAPPER_CLASSES,
} from "./fieldTrigger.tsx";

/**
 * A month as a form holds it: `YYYY-MM`, the value of `<input type="month">`.
 */
const MONTH = /^(\d{4})-(\d{2})$/;

export interface ControlMonthPopoverProps {
  id?: string;
  value?: string;
  disabled?: boolean;
  clearable?: boolean;
  /** First selectable month, `YYYY-MM`. */
  min?: string;
  /** Last selectable month, `YYYY-MM`. */
  max?: string;
  /** Forwarded to the trigger: an `aria-label`, a `data-testid`. */
  triggerProps?: HTMLAttributes<HTMLElement>;
  onChange: (value: string | undefined) => void;
}

/**
 * The month picker: the kit's field trigger, then a year with its twelve
 * months. For a period that is a whole month (a report, an invoice), where a
 * day picker would ask for a day nobody means.
 *
 * The value is `YYYY-MM`, so a schema reads it as a plain string and a
 * server parses it without a time zone.
 */
export const ControlMonthPopover = (props: ControlMonthPopoverProps) => {
  const { tr, l, lang } = useI18n();
  const [open, setOpen] = useState(false);
  const match = props.value ? MONTH.exec(props.value) : null;
  const year = match ? Number(match[1]) : undefined;
  const month = match ? Number(match[2]) : undefined;
  const [shownYear, setShownYear] = useState(
    () => year ?? new Date().getFullYear(),
  );

  const key = (y: number, m: number) =>
    `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}`;
  const outOfRange = (value: string) =>
    (props.min !== undefined && value < props.min) ||
    (props.max !== undefined && value > props.max);

  const formatted =
    year !== undefined && month !== undefined
      ? l(new Date(year, month - 1, 1), {
          date: { year: "numeric", month: "long" },
        })
      : "";
  const monthName = (m: number) =>
    new Date(2000, m - 1, 1).toLocaleString(lang, { month: "short" });

  const showClear = Boolean(props.clearable && match && !props.disabled);
  const size = TRIGGER_SIZES.default;

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (next && year !== undefined) setShownYear(year);
        setOpen(next);
      }}
    >
      <div className={TRIGGER_WRAPPER_CLASSES}>
        <PopoverTrigger
          {...props.triggerProps}
          id={props.id}
          data-slot="date-trigger"
          disabled={props.disabled}
          className={cn(
            TRIGGER_CLASSES,
            size.trigger,
            size.chevron,
            !match && "text-muted-foreground",
          )}
        >
          <span
            data-slot="trigger-label"
            className={cn(
              "flex min-w-0 items-center gap-2",
              showClear && size.clearGap,
            )}
          >
            <CalendarIcon
              className={cn("text-muted-foreground shrink-0", size.icon)}
            />
            <span className="truncate">
              {formatted ||
                tr("controlMonth.placeholder", { default: "Pick a month" })}
            </span>
          </span>
          <ChevronDownIcon className="text-muted-foreground pointer-events-none size-4 shrink-0" />
        </PopoverTrigger>
        {showClear && (
          <ControlClearButton onClick={() => props.onChange(undefined)} />
        )}
      </div>
      <PopoverContent className="w-64 p-2" align="start">
        <div className="mb-2 flex items-center justify-between">
          <Button
            variant="minimal"
            size="icon-sm"
            aria-label={tr("controlMonth.previousYear", {
              default: "Previous year",
            })}
            onClick={() => setShownYear((it) => it - 1)}
          >
            <ChevronLeft className="rtl:-scale-x-100" />
          </Button>
          <span className="text-sm font-medium tabular-nums">{shownYear}</span>
          <Button
            variant="minimal"
            size="icon-sm"
            aria-label={tr("controlMonth.nextYear", { default: "Next year" })}
            onClick={() => setShownYear((it) => it + 1)}
          >
            <ChevronRight className="rtl:-scale-x-100" />
          </Button>
        </div>
        <div className="grid grid-cols-3 gap-1">
          {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => {
            const value = key(shownYear, m);
            const selected = year === shownYear && month === m;
            return (
              <Button
                key={m}
                variant={selected ? "solid" : "minimal"}
                intent={selected ? "primary" : "none"}
                size="sm"
                data-value={value}
                aria-pressed={selected}
                disabled={outOfRange(value)}
                onClick={() => {
                  props.onChange(value);
                  setOpen(false);
                }}
              >
                {monthName(m)}
              </Button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
};
