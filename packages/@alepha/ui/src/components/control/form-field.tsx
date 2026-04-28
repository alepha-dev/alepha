import { Label } from "@alepha/ui/components/ui/label";
import { cn } from "@alepha/ui/lib/utils";
import type { ReactNode } from "react";

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
 * Replaces Mantine's `<Input.Wrapper>`.
 */
export function FormField(props: FormFieldProps) {
  return (
    <div className={cn("flex flex-col gap-1.5", props.className)}>
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
        <p className="text-destructive text-xs" role="alert">
          {props.error}
        </p>
      )}
    </div>
  );
}
