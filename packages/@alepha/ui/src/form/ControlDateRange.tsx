import * as React from "react";

void React;

import {
  ControlClearButton,
  TRIGGER_CLASSES,
  TRIGGER_SIZES,
  TRIGGER_WRAPPER_CLASSES,
} from "@alepha/ui/components/control-base/field-trigger";
import { FormField } from "@alepha/ui/components/control-base/form-field";
import {
  DATE_ONLY,
  formatDateOnly,
  parseDateOnly,
} from "@alepha/ui/components/control-date/date-only.ts";
import { Calendar } from "@alepha/ui/components/ui/calendar";
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
} from "lucide-react";
import { useState } from "react";
import type { DateRange } from "react-day-picker";

export interface ControlDateRangeProps {
  /**
   * Bound `InputField` from `useForm`. Stores `[start, end]`, two date-only
   * strings, or nothing at all.
   */
  input: BaseInputField;
  label?: string;
  description?: string;
  disabled?: boolean;
  /**
   * Offer a way back to empty once a range is picked.
   *
   * A calendar has no "none" cell, so without this an optional range field is
   * one-way. Spelled `clearable` like every other control in the kit, and
   * drawn like one: the kit's `x` on the trigger, not a button beside it.
   */
  clearable?: boolean;
  /**
   * Shown on the trigger while the field is empty.
   */
  placeholder?: string;
  /**
   * Extra classes on the trigger button. A filter bar sizes its slots, and a
   * range trigger holds two dates rather than one, so it usually wants to be
   * wider than its neighbours.
   */
  triggerClassName?: string;
}

/**
 * A closed range of calendar days, as one field.
 *
 * `z.dateRange()` makes both ends mandatory, so this control never writes a
 * half-range: `.optional()` on the schema is the only way to say "no filter",
 * and there is nothing in between.
 *
 * ⚠️ **The field is written on the second CLICK, not on the first complete
 * range**, and the difference is measured rather than assumed. The trap this
 * was written for is DayPicker handing back `{ from }` with no `to`
 * mid-gesture; react-day-picker ^10 does something else, which is worse for a
 * naive control: the first click answers `{ from: d, to: d }`, a complete
 * one-day range. A control that wrote whenever both ends existed would
 * therefore take the start date as the whole range and slam the popover shut
 * before the reader picked an end.
 *
 * So `pending` counts the gesture instead of reading its shape, and it
 * handles both behaviours: a genuinely half range holds, and a
 * DayPicker-completed first click holds too. `control-date-range.browser
 * .spec.tsx` drives two real clicks, which is what found this.
 *
 * ⚠️ **Local parts, never `new Date(value)`.** A date-only string is a
 * calendar day; parsing it as an instant shifts it by one west of Greenwich.
 * The two helpers are `control-date`'s own, shared rather than copied.
 */
export const ControlDateRange = (props: ControlDateRangeProps) => {
  const form = useFormState(props.input, ["error"]);
  const [value, setValue] = useFieldValue(props.input);
  const [open, setOpen] = useState(false);
  /**
   * Whether a selection gesture is half-made: one click in, waiting for the
   * other end. Reset whenever the popover opens, so an abandoned gesture
   * cannot make the next popover's first click look like a second one.
   */
  const [pending, setPending] = useState(false);

  const stored = toRange(value as unknown);
  const storedKey = Array.isArray(value) ? (value as string[]).join(",") : "";
  // The gesture in progress. Seeded from the field, and re-seeded whenever
  // the field moves underneath it - a form reset, or a value arriving from
  // the URL after the first paint.
  const [draft, setDraft] = useState<DateRange | undefined>(stored);
  const [seenKey, setSeenKey] = useState(storedKey);
  if (seenKey !== storedKey) {
    // ⚠️ Adjusted DURING render, not in an effect. React documents this as
    // the way to reset state when an input changes, and the effect version is
    // a lint error here (`react(set-state-in-effect)`) for the reason the
    // rule gives: it renders once with the stale draft and again with the new
    // one, so a value arriving from the URL is visibly wrong for a frame.
    //
    // Keyed on the joined VALUE, never on `stored`: `toRange` builds a new
    // object every render, so comparing objects would reset the draft on
    // every keystroke elsewhere in the form and discard a half-made
    // selection.
    setSeenKey(storedKey);
    setDraft(stored);
  }

  if (!props.input?.props) return null;

  const meta = parseField(props.input, {
    label: props.label,
    description: props.description,
    error: form.error,
  });

  const shown = draft ?? stored;
  const formatted = shown?.from
    ? shown.to
      ? `${shown.from.toLocaleDateString()} - ${shown.to.toLocaleDateString()}`
      : shown.from.toLocaleDateString()
    : "";

  const handleSelect = (next: DateRange | undefined) => {
    setDraft(next);
    if (!next?.from) {
      setPending(false);
      return;
    }
    if (!next.to || !pending) {
      // The first click of a gesture, whichever shape DayPicker gave it. The
      // field keeps whatever it had: writing now would either fail the schema
      // (half a range) or record the start day as the whole range, and
      // clearing would destroy the old range before the new one exists.
      setPending(true);
      return;
    }
    setPending(false);
    setValue([formatDateOnly(next.from), formatDateOnly(next.to)]);
    setOpen(false);
  };

  const showClear = Boolean(props.clearable && stored?.from && !props.disabled);
  const size = TRIGGER_SIZES.default;

  return (
    <FormField
      id={meta.id}
      label={meta.label}
      description={meta.description}
      error={meta.error}
      required={meta.required}
    >
      <Popover
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (next) setPending(false);
        }}
      >
        {/* The kit's field trigger, and the kit's clear button positioned on
            it - `control-base/field-trigger`, the same two the selects on the
            filter bar beside this one draw (feedback #2197). The clear sits
            BESIDE the trigger rather than inside it because a button nested
            in a button is invalid, and Base UI's popover trigger would
            swallow its click anyway. */}
        <div className={TRIGGER_WRAPPER_CLASSES}>
          <PopoverTrigger
            id={meta.id}
            // `date-trigger`, the same slot `ControlDate` claims: `styles.css`
            // gives the `--input-hover` border to a list of `data-slot`s, and
            // this is how the two calendars are on it.
            data-slot="date-trigger"
            disabled={props.disabled}
            // `name` only, never the whole `input.props` spread: those
            // are an `<input>`'s props and this is a button, so their
            // `onChange` signature is genuinely incompatible. The name is
            // what `AutoForm`'s scroll-to-first-error looks a field up by.
            name={props.input.props.name}
            className={cn(
              TRIGGER_CLASSES,
              size.trigger,
              size.chevron,
              // Muted means "nothing picked yet", exactly as on a select.
              !formatted && "text-muted-foreground",
              props.triggerClassName,
            )}
          >
            {/* The room for the clear button - see `clearGap` in
                TRIGGER_SIZES for why it is a margin here and not padding on
                the trigger. */}
            <span
              className={cn(
                "flex min-w-0 items-center gap-2",
                showClear && size.clearGap,
              )}
            >
              {/*
                Muted whatever the field holds, matching every other leading
                icon in the kit. Without the class it inherits the trigger's
                own `color`, which swaps between muted and foreground to grey
                the PLACEHOLDER - so the icon brightened when a range was
                picked. An icon says what kind of field this is, which does
                not change when you fill it.
              */}
              <CalendarIcon
                className={cn("text-muted-foreground shrink-0", size.icon)}
              />
              <span className="truncate">
                {formatted || props.placeholder || "Pick a date range"}
              </span>
            </span>
            {/* The same trailing caret a select trigger carries, appended by
                `ComboboxTrigger` there and written out here: this opens a
                popover, and without it the control reads as a text field that
                happens to have a calendar glyph. */}
            <ChevronDownIcon className="text-muted-foreground pointer-events-none size-4 shrink-0" />
          </PopoverTrigger>
          {showClear && (
            <ControlClearButton
              onClick={() => {
                setDraft(undefined);
                setValue(undefined);
              }}
            />
          )}
        </div>
        <PopoverContent className="w-auto p-0" align="start">
          {/* The range visuals were built and unused: `calendar.tsx` passes
              `...props` straight to DayPicker and already defines
              `range_start` / `range_middle` / `range_end`, which its custom
              `DayButton` reads into styled data attributes. */}
          <Calendar mode="range" selected={shown} onSelect={handleSelect} />
        </PopoverContent>
      </Popover>
    </FormField>
  );
};

/**
 * The stored pair as DayPicker's own shape, or nothing.
 *
 * Anything that is not two parseable date-only strings reads as empty rather
 * than as half a range: the value comes off a URL as often as off a form, and
 * a malformed one is the schema's to reject, not this control's to render.
 */
const toRange = (value: unknown): DateRange | undefined => {
  if (!Array.isArray(value) || value.length !== 2) return undefined;
  const [from, to] = value as string[];
  if (!from || !to || !DATE_ONLY.test(from) || !DATE_ONLY.test(to)) {
    return undefined;
  }
  return { from: parseDateOnly(from), to: parseDateOnly(to) };
};
