import type { ReactNode } from "react";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

export interface FormFieldProps {
  id?: string;
  label?: string;
  description?: string;
  error?: string;
  required?: boolean;
  className?: string;
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
