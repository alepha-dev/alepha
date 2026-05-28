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
import { Calendar as CalendarIcon, Clock } from "lucide-react";
import { useState } from "react";

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
}

export function ControlDate(props: ControlDateProps) {
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
        onChange={(v) => setValue(v)}
      />
    </FormField>
  );
}

interface DatePopoverProps {
  id?: string;
  value?: string;
  withTime: boolean;
  disabled?: boolean;
  onChange: (value: string | undefined) => void;
}

function DatePopover(props: DatePopoverProps) {
  const [open, setOpen] = useState(false);
  const date = props.value ? new Date(props.value) : undefined;

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
      props.onChange(d.toISOString().slice(0, 10));
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

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            id={props.id}
            variant="outline"
            disabled={props.disabled}
            className={cn(
              "w-full justify-start text-left font-normal",
              !date && "text-muted-foreground",
            )}
          />
        }
      >
        <CalendarIcon className="mr-2 size-4" />
        {formatted || "Pick a date"}
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar mode="single" selected={date} onSelect={handleDate} />
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
}
