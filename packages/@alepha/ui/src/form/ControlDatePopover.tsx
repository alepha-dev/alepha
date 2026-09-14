import * as React from "react";

void React;

import {
  Calendar as CalendarIcon,
  ChevronDown as ChevronDownIcon,
} from "lucide-react";
import { useState } from "react";
import type { DayPickerProps } from "react-day-picker";

import { LazyCalendar, preloadCalendar } from "../calendar/LazyCalendar.tsx";
import { Input } from "../core/Input.tsx";
import { Popover, PopoverContent, PopoverTrigger } from "../core/Popover.tsx";
import { cn } from "../core/utils.ts";
import { DATE_ONLY, formatDateOnly, parseDateOnly } from "./dateOnly.ts";
import {
  ControlClearButton,
  TRIGGER_CLASSES,
  TRIGGER_SIZES,
  TRIGGER_WRAPPER_CLASSES,
} from "./fieldTrigger.tsx";

export interface ControlDatePopoverProps {
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

export const ControlDatePopover = (props: ControlDatePopoverProps) => {
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

  const showClear = Boolean(props.clearable && date && !props.disabled);
  const size = TRIGGER_SIZES.default;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      {/* The kit's field trigger, and the kit's clear button positioned on it
          - `control-base/field-trigger`, the same two a select draws. The
          clear sits BESIDE the trigger rather than inside it: a button nested
          in a button is invalid, and Base UI's popover trigger would swallow
          its click anyway. */}
      <div className={TRIGGER_WRAPPER_CLASSES}>
        <PopoverTrigger
          id={props.id}
          // A FIELD trigger, not a button, and the distinction is load
          // bearing: `styles.css` gives the `--input-hover` border to a
          // list of `data-slot`s, and this one was not on it, so the date
          // control was the only field in the kit that did not darken its
          // border under the pointer.
          //
          // ⚠️ It used to render `Button variant="outline"` and then undo
          // the button-ness of it in four overrides - the border token, the
          // hover fill, the open-state fill, the placeholder colour - which
          // is a fair description of why it still did not look like the
          // selects beside it (feedback #2197). The shared trigger is a
          // field to begin with, so there is nothing left to undo.
          data-slot="date-trigger"
          disabled={props.disabled}
          // The calendar is a chunk of its own (`LazyCalendar`). Asking for it
          // as the pointer arrives or focus lands means the click that opens
          // the popover usually finds it already downloaded.
          onPointerEnter={preloadCalendar}
          onFocus={preloadCalendar}
          className={cn(
            TRIGGER_CLASSES,
            size.trigger,
            size.chevron,
            // Muted means "nothing picked yet", exactly as on a select. With
            // a value the text is already `foreground`, so this only matters
            // while empty.
            !date && "text-muted-foreground",
          )}
        >
          {/* The room for the clear button - see `clearGap` in TRIGGER_SIZES
              for why it is a margin here and not padding on the trigger. */}
          <span
            className={cn(
              "flex min-w-0 items-center gap-2",
              showClear && size.clearGap,
            )}
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
            <CalendarIcon
              className={cn("text-muted-foreground shrink-0", size.icon)}
            />
            <span className="truncate">{formatted || "Pick a date"}</span>
          </span>
          {/* Same trailing caret a select trigger carries, for the same
              reason: this opens a popover, and without it the control reads
              as a text field that happens to have a calendar glyph. */}
          <ChevronDownIcon className="text-muted-foreground pointer-events-none size-4 shrink-0" />
        </PopoverTrigger>
        {showClear && (
          <ControlClearButton onClick={() => props.onChange(undefined)} />
        )}
      </div>
      <PopoverContent className="w-auto p-0" align="start">
        <LazyCalendar
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
