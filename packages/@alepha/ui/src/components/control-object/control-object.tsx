import * as React from "react";

void React;

import {
  Control,
  type ControlProps,
} from "@alepha/ui/components/control/control";
import { spanClass, widthFor } from "@alepha/ui/components/control-base/grid";
import { Button } from "@alepha/ui/components/ui/button";
import { type ZObject, z } from "alepha";
import {
  type BaseInputField,
  type ObjectInputField,
  parseField,
  useFieldValue,
  useFormState,
} from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";
import { ChevronDown, ChevronRight, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import {
  childI18nPrefix,
  resolveFieldI18n,
} from "../control-base/field-i18n.ts";

export interface ControlObjectProps {
  /**
   * Bound object `InputField` from `useForm`.
   */
  input: BaseInputField;
  /**
   * Field label. Falls back to schema `title`.
   */
  label?: string;
  /**
   * Helper text shown below the group.
   */
  description?: string;
  /**
   * Number of grid columns. @default 1
   */
  columns?: 1 | 2 | 3 | 4;
  /**
   * "fieldset" wraps in a bordered container with legend. "plain" renders fields only.
   */
  variant?: "fieldset" | "plain";
  /**
   * Per-field control props override, keyed by field name.
   */
  controlProps?: Record<string, Partial<Omit<ControlProps, "input">>>;
  /**
   * Disable the group and all inner controls.
   */
  disabled?: boolean;
  /**
   * Default expanded state. @default true
   */
  defaultExpanded?: boolean;
  /** Dictionary prefix for this object's children (see `resolveFieldI18n`). */
  i18nPrefix?: string;
  /**
   * Allow the user to clear the object (sets value to undefined).
   */
  clearable?: boolean;
}

export function ControlObject(props: ControlObjectProps) {
  const form = useFormState(props.input, ["error"]);
  const [value, setValue] = useFieldValue(props.input);
  const [expanded, setExpanded] = useState(props.defaultExpanded ?? true);
  const { tr } = useI18n();

  if (!props.input?.props) return null;

  const meta = parseField(props.input, {
    label: props.label,
    description: props.description,
    error: form.error,
  });

  // The field schema may be wrapped (optional/nullable/default); peel to the
  // ZodObject before reading its shape.
  const schema = z.schema.unwrap(props.input.schema) as ZObject;
  if (!z.schema.isObject(schema)) return null;

  // ── Init / clear ────────────────────────────────────────────────
  const isInitialized = value != null && typeof value === "object";

  const fieldNames = Object.keys(z.schema.shape(schema));
  const nestedItems = (props.input as ObjectInputField<ZObject>).items as
    | Record<string, BaseInputField>
    | undefined;

  const grid = (
    <div className="grid gap-3 grid-cols-12">
      {fieldNames.map((name) => {
        const field = nestedItems?.[name];
        if (!field) return null;
        const fieldProps = {
          ...(props.controlProps?.[name] ?? {}),
          ...resolveFieldI18n(
            tr as never,
            props.i18nPrefix,
            name,
            props.controlProps?.[name] ?? {},
          ),
          i18nPrefix: childI18nPrefix(props.i18nPrefix, name),
        };
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
            aria-label={tr("controlObject.initialize", {
              default: "Initialize",
            })}
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
            aria-label={tr("controlObject.clear", { default: "Clear" })}
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
            aria-label={
              expanded
                ? tr("controlObject.collapse", { default: "Collapse" })
                : tr("controlObject.expand", { default: "Expand" })
            }
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
