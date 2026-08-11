import {
  FormField,
  formFieldAriaProps,
} from "@alepha/ui/components/control-base/form-field";
import type { IconComponent } from "@alepha/ui/components/control-base/icon-hint";
import { Button } from "@alepha/ui/components/ui/button";
import { Input } from "@alepha/ui/components/ui/input";
import { Eye, EyeOff } from "lucide-react";
import { type HTMLAttributes, useState } from "react";

export interface ControlPasswordProps {
  id?: string;
  name?: string;
  label?: string;
  description?: string;
  error?: string;
  required?: boolean;
  disabled?: boolean;
  autoComplete?: string;
  autoFocus?: boolean;
  minLength?: number;
  maxLength?: number;
  inputProps?: HTMLAttributes<HTMLElement>;
  icon?: IconComponent;
  value: string;
  onChange: (v: string) => void;
}

/**
 * Masked password field with a reveal toggle.
 *
 * Lives outside `Control` so a hand-built form — a dialog that is not driven by
 * a schema — gets the same field the schema path renders, rather than pairing a
 * bare `<Input type="password">` with no way to check what was typed.
 */
export const ControlPassword = (props: ControlPasswordProps) => {
  const [reveal, setReveal] = useState(false);
  const Icon = props.icon;
  return (
    <FormField
      id={props.id}
      label={props.label}
      description={props.description}
      error={props.error}
      required={props.required}
    >
      <div className="relative">
        {Icon && (
          <Icon className="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2 pointer-events-none" />
        )}
        <Input
          {...props.inputProps}
          {...formFieldAriaProps({
            id: props.id,
            error: props.error,
            description: props.description,
          })}
          id={props.id}
          name={props.name}
          type={reveal ? "text" : "password"}
          autoComplete={props.autoComplete ?? "current-password"}
          autoFocus={props.autoFocus}
          disabled={props.disabled}
          required={props.required}
          minLength={props.minLength}
          maxLength={props.maxLength}
          value={props.value}
          onChange={(e) => props.onChange(e.target.value)}
          className={[props.inputProps?.className, Icon ? "pr-9 pl-9" : "pr-9"]
            .filter(Boolean)
            .join(" ")}
        />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          disabled={props.disabled}
          onClick={() => setReveal((r) => !r)}
          aria-label={reveal ? "Hide password" : "Show password"}
          className="text-muted-foreground hover:text-foreground absolute top-1/2 right-1 size-7 -translate-y-1/2"
        >
          {reveal ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
        </Button>
      </div>
    </FormField>
  );
};
