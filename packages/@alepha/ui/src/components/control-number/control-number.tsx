import * as React from "react";

void React;

import { FormField } from "@alepha/ui/components/control-base/form-field";
import { iconFor } from "@alepha/ui/components/control-base/icon-hint";
import { Input } from "@alepha/ui/components/ui/input";
import { Slider } from "@alepha/ui/components/ui/slider";
import {
  type BaseInputField,
  parseField,
  useFieldValue,
  useFormState,
} from "alepha/react/form";

export interface ControlNumberProps {
  /**
   * Bound numeric `InputField` from `useForm`.
   */
  input: BaseInputField;
  /**
   * Field label. Falls back to schema `title`.
   */
  label?: string;
  /**
   * Helper text shown below the input.
   */
  description?: string;
  /**
   * Render as a slider instead of a number input.
   */
  slider?: boolean;
  /**
   * Minimum allowed value. Falls back to schema `minimum`.
   */
  min?: number;
  /**
   * Maximum allowed value. Falls back to schema `maximum`.
   */
  max?: number;
  /**
   * Step size. Falls back to schema `multipleOf`, then 1.
   */
  step?: number;
  /**
   * Disable the input.
   */
  disabled?: boolean;
}

export function ControlNumber(props: ControlNumberProps) {
  const form = useFormState(props.input, ["error"]);
  const [value, setValue] = useFieldValue(props.input);

  if (!props.input?.props) return null;

  const meta = parseField(props.input, {
    label: props.label,
    description: props.description,
    error: form.error,
  });

  const min = props.min ?? meta.constraints.minimum;
  const max = props.max ?? meta.constraints.maximum;

  if (props.slider) {
    const lo = min ?? 0;
    const hi = max ?? 100;
    return (
      <FormField
        id={meta.id}
        label={meta.label}
        description={meta.description}
        error={meta.error}
        required={meta.required}
      >
        <div className="flex items-center gap-3 py-2">
          <Slider
            id={meta.id}
            min={lo}
            max={hi}
            step={props.step ?? 1}
            disabled={props.disabled}
            value={[Number(value ?? lo)]}
            onValueChange={(v) => setValue(Array.isArray(v) ? v[0] : v)}
            className="flex-1"
          />
          <span className="text-muted-foreground w-10 text-right text-sm tabular-nums">
            {value ?? lo}
          </span>
        </div>
      </FormField>
    );
  }

  const Icon = iconFor(meta.iconHint);
  return (
    <FormField
      id={meta.id}
      label={meta.label}
      description={meta.description}
      error={meta.error}
      required={meta.required}
    >
      <div className="relative">
        {Icon && (
          <Icon className="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2" />
        )}
        <Input
          id={meta.id}
          /*
           * Text controls carry the field name; numeric ones did not, so a number
           * rendered as `<input type="number">` with no `name` at all. Two things
           * depended on it: `AutoForm`'s scroll-to-first-error looks the field up
           * with `document.querySelector('[name="…"]')`, so it silently gave up on
           * numeric fields, and the browser cannot label an unnamed field for
           * autofill. Found while writing e2e tests against a price field that no
           * selector could reach.
           */
          name={props.input.props.name}
          type="number"
          min={min}
          max={max}
          step={props.step}
          disabled={props.disabled}
          value={value ?? ""}
          onChange={(e) => {
            const v = e.target.value;
            setValue(v === "" ? undefined : Number(v));
          }}
          className={Icon ? "pl-9" : undefined}
        />
      </div>
    </FormField>
  );
}
