import * as React from "react";

void React;

import { type ZObject, z } from "alepha";
import { useAlepha } from "alepha/react";
import {
  type BaseInputField,
  type ObjectInputField,
  parseField,
  useFieldValue,
  useFormState,
} from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";
import { ChevronDown, ChevronRight, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "../core/Button.tsx";
import { Control, type ControlProps } from "./Control.tsx";
import { childI18nPrefix, resolveFieldI18n } from "./fieldI18n.ts";
import { FormFieldRequiredMark } from "./FormFieldRequiredMark.tsx";
import { spanClass, widthFor } from "./grid.tsx";

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
  /**
   * Dictionary prefix for this object's children (see `resolveFieldI18n`).
   */
  i18nPrefix?: string;
  /**
   * Take the clear button away from an optional object.
   *
   * The schema decides by default: an optional or nullable object that has
   * been initialised offers the button, and `false` opts out - the same way
   * round as a text field's `clearable`, and for the same reason. Pass
   * `false` when clearing is not something the API can honour, so the button
   * does not promise an edit that silently does nothing.
   *
   * This used to be opt-IN, which made the button unreachable: `Control` is
   * the only thing that mounts this component and it never passed the prop,
   * so an initialised optional object could not be cleared from the UI at
   * all.
   */
  clearable?: boolean;
}

export const ControlObject = (props: ControlObjectProps) => {
  const form = useFormState(props.input, ["error"]);
  const [value, setValue] = useFieldValue(props.input);
  const [expanded, setExpanded] = useState(props.defaultExpanded ?? true);
  const { tr } = useI18n();
  const alepha = useAlepha();

  // An error under a collapsed object must be reachable: open it the moment
  // one lands on a field inside, so the field mounts and shows it (and
  // `AutoForm` can bring it into view).
  const formId = props.input?.form?.id;
  const path = props.input?.path;
  useEffect(() => {
    if (!formId || !path) return;
    return alepha.events.on("form:errors:changed", (event) => {
      if (
        event.id === formId &&
        Object.keys(event.errors).some((key) => key.startsWith(`${path}/`))
      ) {
        setExpanded(true);
      }
    });
  }, [alepha, formId, path]);

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

  // `clearable !== false`, not `clearable === true`: the schema is the
  // answer, and a caller opts out. A required object has nothing to clear to.
  const showClear =
    isInitialized &&
    !meta.required &&
    !props.disabled &&
    props.clearable !== false;

  const fieldNames = Object.keys(z.schema.shape(schema));
  const nestedItems = (props.input as ObjectInputField<ZObject>).items as
    | Record<string, BaseInputField>
    | undefined;

  const grid = (
    <div className="grid grid-cols-12 gap-3">
      {fieldNames.map((name) => {
        const field = nestedItems?.[name];
        if (!field) return null;
        const fieldProps = {
          ...props.controlProps?.[name],
          ...resolveFieldI18n(
            tr,
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
        meta.error ? "border-danger" : "border-border"
      }`}
    >
      <div className="flex items-start gap-3">
        {!isInitialized && !props.disabled ? (
          <Button
            type="button"
            variant="outlined"
            size="icon"
            className="size-8 shrink-0"
            aria-label={tr("controlObject.initialize", {
              default: "Initialize",
            })}
            onClick={() => setValue({})}
          >
            <Plus className="size-4" />
          </Button>
        ) : showClear ? (
          <Button
            type="button"
            variant="minimal"
            size="icon"
            className="size-8 shrink-0"
            aria-label={tr("controlObject.clear", { default: "Clear" })}
            onClick={() => setValue(undefined)}
          >
            <Trash2 className="size-4" />
          </Button>
        ) : // No placeholder when there is no button: an empty 32px box
        // indented the title past the field labels below it (#Q3426).
        null}
        <div className="flex min-w-0 flex-1 flex-col">
          {meta.label && (
            <legend className="text-sm leading-tight font-medium">
              {meta.label}
              {meta.required && <FormFieldRequiredMark />}
            </legend>
          )}
          {meta.description && (
            <p className="text-muted-foreground text-xs leading-tight">
              {meta.description}
            </p>
          )}
          {meta.error && (
            <p className="text-danger-text text-xs leading-tight">
              {meta.error}
            </p>
          )}
        </div>
        {isInitialized && (
          <Button
            type="button"
            variant="minimal"
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
};
