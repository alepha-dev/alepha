import * as React from "react";

void React;

import { Label } from "@alepha/ui/components/ui/label";
import { cn } from "@alepha/ui/lib/utils";
import { createContext, type ReactNode, useContext, useMemo } from "react";

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

/**
 * Id of the error element a `<FormField id={id} error>` renders.
 */
export function formFieldErrorId(
  id?: string,
  error?: string,
): string | undefined {
  return id && error ? `${id}-error` : undefined;
}

/**
 * Id of the description element a `<FormField id={id} description>` renders
 * (the description is replaced by the error when both are set).
 */
export function formFieldDescriptionId(
  id?: string,
  description?: string,
  error?: string,
): string | undefined {
  return id && description && !error ? `${id}-description` : undefined;
}

/**
 * The aria attributes a control spreads on its native element when it
 * renders its own `<FormField>` (id/error/description in hand). Widgets
 * nested under someone else's FormField use {@link useFormFieldA11y}
 * instead.
 */
export function formFieldAriaProps(props: {
  id?: string;
  error?: string;
  description?: string;
}): { "aria-invalid"?: true; "aria-describedby"?: string } {
  return {
    "aria-invalid": props.error ? true : undefined,
    "aria-describedby":
      formFieldErrorId(props.id, props.error) ??
      formFieldDescriptionId(props.id, props.description, props.error),
  };
}

export interface FormFieldA11y {
  /**
   * `true` when the surrounding FormField carries an error — mirror it
   * onto the widget's `aria-invalid`.
   */
  invalid?: true;
  /**
   * Id of the FormField's error (or description) element — mirror it
   * onto the widget's `aria-describedby`.
   */
  describedBy?: string;
}

const FormFieldA11yContext = createContext<FormFieldA11y>({});

/**
 * Read the surrounding FormField's accessibility wiring. Leaf widgets
 * spread the result onto their native element so screen readers announce
 * the invalid state and the error/description text:
 *
 * ```tsx
 * const a11y = useFormFieldA11y();
 * <input aria-invalid={a11y.invalid} aria-describedby={a11y.describedBy} />
 * ```
 */
export function useFormFieldA11y(): FormFieldA11y {
  return useContext(FormFieldA11yContext);
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

  const errorId = formFieldErrorId(props.id, props.error);
  const descriptionId = formFieldDescriptionId(
    props.id,
    props.description,
    props.error,
  );
  const a11y = useMemo<FormFieldA11y>(
    () => ({
      invalid: props.error ? true : undefined,
      describedBy: errorId ?? descriptionId,
    }),
    [props.error, errorId, descriptionId],
  );
  const children = (
    <FormFieldA11yContext.Provider value={a11y}>
      {props.children}
    </FormFieldA11yContext.Provider>
  );

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
            <p id={descriptionId} className="text-muted-foreground text-xs">
              {props.description}
            </p>
          )}
          {props.error && (
            <p
              id={errorId}
              className="text-destructive text-xs flex items-center gap-1"
              role="alert"
            >
              <span aria-hidden>⚠</span>
              {props.error}
            </p>
          )}
        </div>
        <div className="flex min-w-0 justify-start sm:justify-end">
          {children}
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
      {children}
      {props.description && !props.error && (
        <p id={descriptionId} className="text-muted-foreground text-xs">
          {props.description}
        </p>
      )}
      {props.error && (
        <p
          id={errorId}
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
