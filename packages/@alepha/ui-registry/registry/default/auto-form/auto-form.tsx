import type { TObject } from "alepha";
import type { FormModel } from "alepha/react/form";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Control, type ControlProps } from "@/registry/default/control/control";

export interface AutoFormProps<T extends TObject> {
  /** A FormModel returned by `useForm({ schema, handler })`. */
  form: FormModel<T>;
  /** Per-field control props override, keyed by field name. */
  fields?: Partial<
    Record<keyof T["properties"] & string, Partial<Omit<ControlProps, "input">>>
  >;
  /** Submit button label. */
  submitLabel?: string;
  /** Hide the built-in submit button (caller renders its own). */
  noSubmit?: boolean;
  /** Extra content rendered between the fields and the submit button. */
  footer?: ReactNode;
  className?: string;
}

/**
 * Schema-driven form. Renders one `<Control>` per top-level property of the
 * `useForm` schema. Fall back to hand-rolled `<Control>` calls when you need
 * fine-grained layout (e.g. mixing fields across columns).
 */
export function AutoForm<T extends TObject>(props: AutoFormProps<T>) {
  const inputs = props.form.input as Record<string, never>;
  const names = Object.keys(inputs);

  return (
    <form {...props.form.props} className={props.className}>
      <div className="flex flex-col gap-4">
        {names.map((name) => {
          const fieldOverride =
            props.fields?.[name as keyof typeof props.fields] ?? {};
          return <Control key={name} input={inputs[name]} {...fieldOverride} />;
        })}
        {props.footer}
        {!props.noSubmit && (
          <Button type="submit" disabled={props.form.submitting}>
            {props.submitLabel ?? "Save"}
          </Button>
        )}
      </div>
    </form>
  );
}
