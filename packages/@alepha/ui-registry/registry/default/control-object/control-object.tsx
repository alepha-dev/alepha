import type { TObject } from "alepha";
import {
  type BaseInputField,
  type ObjectInputField,
  parseField,
  useFieldValue,
  useFormState,
} from "alepha/react/form";
import { ChevronDown, ChevronRight, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Control, type ControlProps } from "@/registry/default/control/control";
import { spanClass, widthFor } from "@/registry/default/control-base/grid";

export interface ControlObjectProps {
  input: BaseInputField;
  label?: string;
  description?: string;
  /** Number of grid columns. @default 1 */
  columns?: 1 | 2 | 3 | 4;
  /** "fieldset" wraps in a bordered container with legend. "plain" renders fields only. */
  variant?: "fieldset" | "plain";
  /** Per-field control props override, keyed by field name. */
  controlProps?: Record<string, Partial<Omit<ControlProps, "input">>>;
  disabled?: boolean;
  /** Default expanded state. @default true */
  defaultExpanded?: boolean;
  /** Allow the user to clear the object (sets value to undefined). */
  clearable?: boolean;
}

export function ControlObject(props: ControlObjectProps) {
  const form = useFormState(props.input, ["error"]);
  const [value, setValue] = useFieldValue(props.input);
  const [expanded, setExpanded] = useState(props.defaultExpanded ?? true);

  if (!props.input?.props) return null;

  const meta = parseField(props.input, {
    label: props.label,
    description: props.description,
    error: form.error,
  });

  const schema = props.input.schema as TObject;
  if (!schema?.properties) return null;

  // ── Init / clear ────────────────────────────────────────────────
  const isInitialized = value != null && typeof value === "object";

  const fieldNames = Object.keys(schema.properties);
  const nestedItems = (props.input as ObjectInputField<TObject>).items as
    | Record<string, BaseInputField>
    | undefined;

  const grid = (
    <div className="grid gap-3 grid-cols-12">
      {fieldNames.map((name) => {
        const field = nestedItems?.[name];
        if (!field) return null;
        const fieldProps = props.controlProps?.[name] ?? {};
        const width = widthFor(field, fieldProps.width as number | undefined);
        return (
          <div key={name} className={spanClass(width)}>
            <Control input={field} disabled={props.disabled} {...fieldProps} />
          </div>
        );
      })}
    </div>
  );

  if (props.variant === "plain") return grid;

  return (
    <fieldset
      className={`rounded-md border p-3 ${
        meta.error ? "border-destructive" : "border-border"
      }`}
    >
      <div className="flex items-start gap-3">
        {!isInitialized && !props.disabled ? (
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="size-8 shrink-0"
            aria-label="Initialize"
            onClick={() => setValue({})}
          >
            <Plus className="size-4" />
          </Button>
        ) : props.clearable && !props.disabled ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8 shrink-0"
            aria-label="Clear"
            onClick={() => setValue(undefined)}
          >
            <Trash2 className="size-4" />
          </Button>
        ) : (
          <div className="size-8 shrink-0" />
        )}
        <div className="flex flex-col min-w-0 flex-1">
          {meta.label && (
            <legend className="text-sm font-medium leading-tight">
              {meta.label}
              {meta.required && (
                <span className="text-destructive ml-0.5">*</span>
              )}
            </legend>
          )}
          {meta.description && (
            <p className="text-muted-foreground text-xs leading-tight">
              {meta.description}
            </p>
          )}
          {meta.error && (
            <p className="text-destructive text-xs leading-tight">
              {meta.error}
            </p>
          )}
        </div>
        {isInitialized && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8 shrink-0"
            aria-label={expanded ? "Collapse" : "Expand"}
            onClick={() => setExpanded((e) => !e)}
          >
            {expanded ? (
              <ChevronDown className="size-4" />
            ) : (
              <ChevronRight className="size-4" />
            )}
          </Button>
        )}
      </div>
      {expanded && isInitialized && <div className="mt-3">{grid}</div>}
    </fieldset>
  );
}
