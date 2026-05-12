import { createContext, type ReactNode, useContext } from "react";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

export type FormFieldLayout = "stack" | "row";

/**
 * Ambient layout for every nested `<FormField>`. Defaults to `"stack"`.
 * `<AutoForm layout="row">` wraps its tree in this context so every Control
 * variant renders as a settings-style row without prop drilling.
 */
const FormFieldLayoutContext = createContext<FormFieldLayout>("stack");

export function FormFieldLayoutProvider(props: {
  value: FormFieldLayout;
  children: ReactNode;
}) {
  return (
    <FormFieldLayoutContext.Provider value={props.value}>
      {props.children}
    </FormFieldLayoutContext.Provider>
  );
}

/**
 * Ambient flag enabling the inline save (tick) affordance on text Controls.
 * Set by `<AutoForm autoSave>`; standalone Controls never show the tick
 * unless explicitly placed inside this provider.
 */
const FormFieldAutoSaveContext = createContext<boolean>(false);

export function FormFieldAutoSaveProvider(props: {
  value: boolean;
  children: ReactNode;
}) {
  return (
    <FormFieldAutoSaveContext.Provider value={props.value}>
      {props.children}
    </FormFieldAutoSaveContext.Provider>
  );
}

/**
 * Read the ambient auto-save flag (see {@link FormFieldAutoSaveProvider}).
 */
export function useFormFieldAutoSave(): boolean {
  return useContext(FormFieldAutoSaveContext);
}

export interface FormFieldProps {
  /**
   * `id` linked to the inner control's `htmlFor`.
   */
  id?: string;
  /**
   * Label text rendered above the control.
   */
  label?: string;
  /**
   * Helper text rendered below the control.
   */
  description?: string;
  /**
   * Error message. When set, marks descendant inputs invalid via `data-invalid`.
   */
  error?: string;
  /**
   * Show a required marker (`*`) next to the label.
   */
  required?: boolean;
  /**
   * Extra classes applied to the wrapper.
   */
  className?: string;
  /**
   * Layout variant.
   * - `"stack"` (default): label on top, control below, description under.
   * - `"row"`: settings-style — label/description on the left, control on
   *   the right. Stacks on narrow viewports.
   *
   * When omitted, falls back to the ambient `<FormFieldLayoutProvider>`.
   */
  layout?: FormFieldLayout;
  /**
   * The control to wrap.
   */
  children: ReactNode;
}

/**
 * Label + description + error wrapper shared by every Control variant.
 *
 * When `error` is set, applies a red ring to any descendant `<input>`,
 * `<textarea>`, or trigger button via the `data-invalid` attribute (so we
 * don't have to thread `error` through every leaf widget).
 */
export function FormField(props: FormFieldProps) {
  const ambient = useContext(FormFieldLayoutContext);
  const layout = props.layout ?? ambient;
  const invalidClasses = props.error
    ? "[&_input]:border-destructive [&_input]:focus-visible:ring-destructive/30 [&_textarea]:border-destructive [&_textarea]:focus-visible:ring-destructive/30 [&_[role=combobox]]:border-destructive"
    : "";
  const dataInvalid = props.error ? true : undefined;

  if (layout === "row") {
    return (
      <div
        className={cn(
          "flex flex-col gap-3 px-4 py-3 sm:grid sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-6",
          invalidClasses,
          props.className,
        )}
        data-invalid={dataInvalid}
      >
        <div className="flex flex-col gap-0.5">
          {props.label && (
            <Label htmlFor={props.id} className="font-medium">
              {props.label}
              {props.required && (
                <span className="text-destructive ml-0.5" aria-hidden>
                  *
                </span>
              )}
            </Label>
          )}
          {props.description && !props.error && (
            <p className="text-muted-foreground text-xs">{props.description}</p>
          )}
          {props.error && (
            <p
              className="text-destructive text-xs flex items-center gap-1"
              role="alert"
            >
              <span aria-hidden>⚠</span>
              {props.error}
            </p>
          )}
        </div>
        <div className="flex min-w-0 justify-start sm:justify-end">
          {props.children}
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn("flex flex-col gap-1.5", invalidClasses, props.className)}
      data-invalid={dataInvalid}
    >
      {props.label && (
        <Label htmlFor={props.id}>
          {props.label}
          {props.required && (
            <span className="text-destructive ml-0.5" aria-hidden>
              *
            </span>
          )}
        </Label>
      )}
      {props.children}
      {props.description && !props.error && (
        <p className="text-muted-foreground text-xs">{props.description}</p>
      )}
      {props.error && (
        <p
          className="text-destructive text-xs flex items-center gap-1"
          role="alert"
        >
          <span aria-hidden>⚠</span>
          {props.error}
        </p>
      )}
    </div>
  );
}
