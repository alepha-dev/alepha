import * as React from "react";

void React;

import { FormField } from "@alepha/ui/components/control-base/form-field";
import { Button } from "@alepha/ui/components/ui/button";
import { Calendar } from "@alepha/ui/components/ui/calendar";
import { Input } from "@alepha/ui/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@alepha/ui/components/ui/popover";
import { cn } from "@alepha/ui/lib/utils";
import {
  type BaseInputField,
  parseField,
  useFieldValue,
  useFormState,
} from "alepha/react/form";
import {
  Calendar as CalendarIcon,
  ChevronDown as ChevronDownIcon,
  Clock,
  X,
} from "lucide-react";
import { useState } from "react";
import type { DayPickerProps } from "react-day-picker";

/** How many years back a `birthdate` picker offers. Covers every living
 *  person; the oldest verified human reached 122. */
const BIRTHDATE_YEARS = 120;

export interface ControlDateProps {
  /**
   * Bound `InputField` from `useForm`. Stores an ISO string.
   */
  input: BaseInputField;
  /**
   * Field label. Falls back to schema `title`.
   */
  label?: string;
  /**
   * Helper text shown below the picker.
   */
  description?: string;
  /**
   * Force date-only mode regardless of schema format.
   */
  date?: boolean;
  /**
   * Force date-time mode regardless of schema format.
   */
  datetime?: boolean;
  /**
   * Force time-only mode regardless of schema format.
   */
  time?: boolean;
  /**
   * Disable the picker.
   */
  disabled?: boolean;
  /**
   * Offer a way back to empty once a date is picked.
   *
   * A calendar has no "none" cell, so without this an optional date field is
   * one-way: pick a day and there is no gesture that unsets it. Every other
   * control in the kit spells this `clearable`, so this one does too.
   */
  clearable?: boolean;
  /**
   * Caption style. `"label"` (the default) shows the month name with
   * previous/next arrows; `"dropdown"` swaps both for month and year selects.
   *
   * Arrows are fine for a date near today and hopeless for one that is not:
   * reaching a 1988 birthday costs about 450 clicks on `<`. Pair `"dropdown"`
   * with {@link startMonth} / {@link endMonth}, or use {@link birthdate},
   * which sets both.
   */
  captionLayout?: DayPickerProps["captionLayout"];
  /**
   * First selectable month. Also bounds the year dropdown, which otherwise
   * offers a narrow range around today.
   */
  startMonth?: Date;
  /** Last selectable month. */
  endMonth?: Date;
  /**
   * Shorthand for a date of birth: a year dropdown covering the last
   * {@link BIRTHDATE_YEARS} years, ending this year.
   *
   * Sugar over `captionLayout` + `startMonth` / `endMonth`, which stay
   * available for any other historical field. An explicit value for one of
   * those wins over what this sets.
   */
  birthdate?: boolean;
}

export const ControlDate = (props: ControlDateProps) => {
  const form = useFormState(props.input, ["error"]);
  const [value, setValue] = useFieldValue(props.input);

  if (!props.input?.props) return null;

  const meta = parseField(props.input, {
    label: props.label,
    description: props.description,
    error: form.error,
  });

  const isDateTime = props.datetime || meta.format === "date-time";
  const isTime = props.time || meta.format === "time";

  if (isTime) {
    return (
      <FormField
        id={meta.id}
        label={meta.label}
        description={meta.description}
        error={meta.error}
        required={meta.required}
      >
        <div className="relative">
          <Clock className="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2" />
          <Input
            id={meta.id}
            name={props.input.props.name}
            type="time"
            className="pl-9"
            disabled={props.disabled}
            value={value ?? ""}
            onChange={(e) => setValue(e.target.value)}
          />
        </div>
      </FormField>
    );
  }

  const thisYear = new Date().getFullYear();

  return (
    <FormField
      id={meta.id}
      label={meta.label}
      description={meta.description}
      error={meta.error}
      required={meta.required}
    >
      <DatePopover
        id={meta.id}
        value={value}
        withTime={isDateTime}
        disabled={props.disabled}
        clearable={props.clearable}
        captionLayout={
          props.captionLayout ?? (props.birthdate ? "dropdown" : undefined)
        }
        startMonth={
          props.startMonth ??
          (props.birthdate
            ? new Date(thisYear - BIRTHDATE_YEARS, 0, 1)
            : undefined)
        }
        endMonth={
          props.endMonth ??
          (props.birthdate ? new Date(thisYear, 11, 31) : undefined)
        }
        onChange={(v) => setValue(v)}
      />
    </FormField>
  );
};

interface DatePopoverProps {
  id?: string;
  value?: string;
  withTime: boolean;
  disabled?: boolean;
  clearable?: boolean;
  captionLayout?: DayPickerProps["captionLayout"];
  startMonth?: Date;
  endMonth?: Date;
  onChange: (value: string | undefined) => void;
}

/**
 * A date-only value (`YYYY-MM-DD`) names a calendar day, so it is parsed
 * and formatted in local parts: `new Date("2026-08-23")` is UTC midnight,
 * which displays as the 22nd west of Greenwich, and `toISOString()` on a
 * local midnight stores the previous day east of it.
 */
const parseDateOnly = (value: string): Date => {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
};

const formatDateOnly = (date: Date): string => {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
};

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

const DatePopover = (props: DatePopoverProps) => {
  const [open, setOpen] = useState(false);
  const date = props.value
    ? !props.withTime && DATE_ONLY.test(props.value)
      ? parseDateOnly(props.value)
      : new Date(props.value)
    : undefined;

  const formatted = date
    ? props.withTime
      ? date.toLocaleString()
      : date.toLocaleDateString()
    : "";

  const handleDate = (d: Date | undefined) => {
    if (!d) {
      props.onChange(undefined);
      return;
    }
    if (props.withTime) {
      props.onChange(d.toISOString());
    } else {
      props.onChange(formatDateOnly(d));
      setOpen(false);
    }
  };

  const handleTime = (timeStr: string) => {
    if (!date) return;
    const [h, m] = timeStr.split(":").map(Number);
    const next = new Date(date);
    next.setHours(h ?? 0, m ?? 0, 0, 0);
    props.onChange(next.toISOString());
  };

  const timeValue =
    date && props.withTime
      ? `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`
      : "";

  const showClear = props.clearable && !!date && !props.disabled;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      {/* The clear button sits BESIDE the trigger, not inside it: a button
          nested in a button is invalid, and Base UI's popover trigger would
          swallow its click anyway. */}
      <div className="flex w-full items-center gap-1">
        <PopoverTrigger
          render={
            <Button
              id={props.id}
              // A FIELD trigger, not a button, and the distinction is load
              // bearing: `styles.css` gives the `--input-hover` border to a
              // list of `data-slot`s, and this one was not on it, so the date
              // control was the only field in the kit that did not darken its
              // border under the pointer. Overriding Base UI's own
              // `data-slot="button"` is safe - nothing selects on it.
              data-slot="date-trigger"
              variant="outline"
              disabled={props.disabled}
              className={cn(
                "flex-1 justify-start text-left font-normal",
                // Undo the outline variant's hover fill AND its open-state
                // fill. A select trigger shades for neither: the border is the
                // affordance in both cases, and a field that greys out while
                // its own popover is open reads as disabled at the moment it
                // is most active. Neither `select-trigger` nor
                // `combobox-trigger` carries an `aria-expanded:bg-*` rule at
                // all, which is the behaviour being matched.
                //
                // ⚠️ Each modifier has to match the variant's own EXACTLY -
                // `hover:` and `aria-expanded:` - or tailwind-merge keeps both
                // rules and the winner is down to specificity, which the
                // longer modifier chain wins.
                "hover:bg-background aria-expanded:bg-background",
                // Same reasoning for the placeholder: a select leaves it muted
                // under the pointer. With a value the text is already
                // `foreground`, so this only matters while empty.
                !date &&
                  "text-muted-foreground hover:text-muted-foreground aria-expanded:text-muted-foreground",
              )}
            />
          }
        >
          {/*
            Muted whatever the field holds, matching `InputGroupAddon`, which
            paints every other leading icon in the kit `text-muted-foreground`
            on the container.

            Without the class this icon simply inherits the trigger's `color`,
            which the control swaps between muted and foreground to grey the
            PLACEHOLDER - so the icon brightened when a date was picked. That
            looked deliberate and was not: an icon says what kind of field this
            is, which does not change when you fill it, and the text beside it
            already carries filled-versus-empty.
          */}
          <CalendarIcon className="text-muted-foreground mr-2 size-4" />
          {formatted || "Pick a date"}
          {/* Same trailing caret a select trigger carries, for the same
              reason: this opens a popover, and without it the control reads
              as a text field that happens to have a calendar glyph. `ml-auto`
              rather than `justify-between` so the calendar icon and the text
              stay together on the left. */}
          <ChevronDownIcon className="text-muted-foreground pointer-events-none ml-auto size-4 shrink-0" />
        </PopoverTrigger>
        {showClear && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Clear date"
            onClick={() => props.onChange(undefined)}
          >
            <X className="size-4" />
          </Button>
        )}
      </div>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={date}
          onSelect={handleDate}
          captionLayout={props.captionLayout}
          startMonth={props.startMonth}
          endMonth={props.endMonth}
        />
        {props.withTime && (
          <div className="border-t p-3">
            <Input
              type="time"
              value={timeValue}
              onChange={(e) => handleTime(e.target.value)}
            />
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
};
