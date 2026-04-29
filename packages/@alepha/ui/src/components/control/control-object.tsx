import {
  Control,
  type ControlProps,
} from "@alepha/ui/components/control/control";
import type { TObject } from "alepha";
import {
  type BaseInputField,
  type ObjectInputField,
  parseField,
  useFormState,
} from "alepha/react/form";

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
}

const colsClass: Record<number, string> = {
  1: "grid-cols-1",
  2: "grid-cols-2",
  3: "grid-cols-3",
  4: "grid-cols-4",
};

export function ControlObject(props: ControlObjectProps) {
  const form = useFormState(props.input, ["error"]);

  if (!props.input?.props) return null;

  const meta = parseField(props.input, {
    label: props.label,
    description: props.description,
    error: form.error,
  });

  const schema = props.input.schema as TObject;
  if (!schema?.properties) return null;

  const fieldNames = Object.keys(schema.properties);
  const nestedItems = (props.input as ObjectInputField<TObject>).items as
    | Record<string, BaseInputField>
    | undefined;

  const grid = (
    <div className={`grid gap-4 ${colsClass[props.columns ?? 1]}`}>
      {fieldNames.map((name) => {
        const field = nestedItems?.[name];
        if (!field) return null;
        const fieldProps = props.controlProps?.[name] ?? {};
        return <Control key={name} input={field} {...fieldProps} />;
      })}
    </div>
  );

  if (props.variant === "plain") return grid;

  return (
    <fieldset className="border-border rounded-md border p-4">
      {meta.label && (
        <legend className="px-1 text-sm font-medium">{meta.label}</legend>
      )}
      <div className="flex flex-col gap-3">
        {meta.description && (
          <p className="text-muted-foreground text-xs">{meta.description}</p>
        )}
        {grid}
        {meta.error && <p className="text-destructive text-xs">{meta.error}</p>}
      </div>
    </fieldset>
  );
}
