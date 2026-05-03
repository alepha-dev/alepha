import { Label } from "@alepha/ui/components/ui/label";
import { cn } from "@alepha/ui/lib/utils";
import type { ReactNode } from "react";

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
  return (
    <div
      className={cn(
        "flex flex-col gap-1.5",
        // child styling hooks: any input/textarea/select inside picks up
        // a destructive ring when the wrapper is invalid
        props.error &&
          "[&_input]:border-destructive [&_input]:focus-visible:ring-destructive/30 [&_textarea]:border-destructive [&_textarea]:focus-visible:ring-destructive/30 [&_[role=combobox]]:border-destructive",
        props.className,
      )}
      data-invalid={props.error ? true : undefined}
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
