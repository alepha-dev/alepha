import * as React from "react";

void React;

import {
  type BaseInputField,
  parseField,
  useFieldValue,
  useFormState,
} from "alepha/react/form";
import { Clock } from "lucide-react";
import type { DayPickerProps } from "react-day-picker";

import { Input } from "../core/Input.tsx";
import { ControlDatePopover } from "./ControlDatePopover.tsx";
import { FormField } from "./FormField.tsx";

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
   * control in the kit spells this `clearable`, so this one does too - and
   * draws it the same way, as the kit's `x` on the trigger.
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
      <ControlDatePopover
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

/** How many years back a `birthdate` picker offers. Covers every living
 *  person; the oldest verified human reached 122. */
const BIRTHDATE_YEARS = 120;
