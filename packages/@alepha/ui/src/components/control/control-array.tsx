import {
  Control,
  type ControlProps,
} from "@alepha/ui/components/control/control";
import { Button } from "@alepha/ui/components/ui/button";
import type { TObject, TSchema } from "alepha";
import { useAlepha } from "alepha/react";
import {
  type BaseInputField,
  parseField,
  useFormState,
} from "alepha/react/form";
import { Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

interface ArrayItem {
  key: number;
  value: unknown;
}

export interface ControlArrayProps {
  input: BaseInputField;
  label?: string;
  description?: string;
  min?: number;
  max?: number;
  addLabel?: string;
  columns?: 1 | 2 | 3 | 4;
  variant?: "fieldset" | "plain";
  controlProps?: Record<string, Partial<Omit<ControlProps, "input">>>;
  itemControlProps?: Partial<Omit<ControlProps, "input">>;
}

const colsClass: Record<number, string> = {
  1: "grid-cols-1",
  2: "grid-cols-2",
  3: "grid-cols-3",
  4: "grid-cols-4",
};

const useArrayItems = (input: BaseInputField | undefined) => {
  const alepha = useAlepha();
  const counter = useRef(0);
  const [items, setItemsState] = useState<ArrayItem[]>(() => {
    const initial = input?.initialValue;
    return Array.isArray(initial)
      ? initial.map((value) => ({ key: counter.current++, value }))
      : [];
  });

  const sync = useCallback((next: unknown[] | undefined) => {
    if (!Array.isArray(next)) {
      setItemsState([]);
      return;
    }
    setItemsState((prev) => {
      if (
        prev.length === next.length &&
        prev.every((it, i) => it.value === next[i])
      ) {
        return prev;
      }
      counter.current = 0;
      return next.map((value) => ({ key: counter.current++, value }));
    });
  }, []);

  useEffect(() => {
    if (!input?.form) return;
    const formId = input.form.id;
    const path = input.path;
    return alepha.events.on("form:change", (e) => {
      if (e.id === formId && e.path === path) sync(e.value as unknown[]);
    });
  }, [alepha, input, sync]);

  const setItems = useCallback(
    (next: ArrayItem[]) => {
      setItemsState(next);
      input?.set(next.map((it) => it.value));
    },
    [input],
  );

  return { items, setItems, nextKey: () => counter.current++ };
};

const buildItemInput = (
  parent: BaseInputField,
  schema: TSchema,
  index: number,
  value: unknown,
  onChange: (v: unknown) => void,
): BaseInputField => ({
  schema,
  path: `${parent.path}/${index}`,
  required: false,
  form: parent.form,
  initialValue: value,
  props: {
    id: `${parent.props.id}-${index}`,
    name: `${parent.props.name}[${index}]`,
  },
  set: onChange,
});

const buildFieldInput = (
  parent: BaseInputField,
  itemSchema: TObject,
  fieldName: string,
  index: number,
  itemValue: Record<string, unknown> | undefined,
  onFieldChange: (field: string, value: unknown) => void,
): BaseInputField => ({
  schema: itemSchema.properties[fieldName],
  path: `${parent.path}/${index}/${fieldName}`,
  required: itemSchema.required?.includes(fieldName) ?? false,
  form: parent.form,
  initialValue: itemValue?.[fieldName],
  props: {
    id: `${parent.props.id}-${index}-${fieldName}`,
    name: `${parent.props.name}[${index}].${fieldName}`,
  },
  set: (v: unknown) => onFieldChange(fieldName, v),
});

export function ControlArray(props: ControlArrayProps) {
  const form = useFormState(props.input, ["error"]);
  const { items, setItems, nextKey } = useArrayItems(props.input);

  if (!props.input?.props) return null;

  const meta = parseField(props.input, {
    label: props.label,
    description: props.description,
    error: form.error,
  });

  const schema = props.input.schema;
  if (!schema || !("items" in schema)) return null;

  const itemSchema = (schema as { items: TSchema }).items;
  const objectItemSchema =
    itemSchema && "properties" in itemSchema ? (itemSchema as TObject) : null;
  const { min = 0, max = Number.POSITIVE_INFINITY, columns = 1 } = props;
  const fieldNames = objectItemSchema
    ? Object.keys(objectItemSchema.properties)
    : [];

  const handleAdd = () => {
    if (items.length >= max) return;
    let value: unknown;
    if (objectItemSchema) {
      value = {};
      for (const [k, p] of Object.entries(objectItemSchema.properties)) {
        if ("default" in p) (value as Record<string, unknown>)[k] = p.default;
      }
    } else {
      value = "";
    }
    setItems([...items, { key: nextKey(), value }]);
  };

  const handleRemove = (index: number) => {
    if (items.length <= min) return;
    setItems(items.filter((_, i) => i !== index));
  };

  const updateItem = (index: number, value: unknown) => {
    const next = [...items];
    next[index] = { ...next[index], value };
    setItems(next);
  };

  const updateField = (index: number, field: string, value: unknown) => {
    const next = [...items];
    const current = (next[index].value as Record<string, unknown>) ?? {};
    next[index] = { ...next[index], value: { ...current, [field]: value } };
    setItems(next);
  };

  const list = (
    <div className="flex flex-col gap-2">
      {items.map((item, index) => (
        <div
          key={item.key}
          className="bg-muted/30 flex items-start gap-2 rounded-md border p-3"
        >
          <div className="flex-1">
            {objectItemSchema ? (
              <div className={`grid gap-3 ${colsClass[columns]}`}>
                {fieldNames.map((name) => {
                  const fieldProps = props.controlProps?.[name] ?? {};
                  const fieldInput = buildFieldInput(
                    props.input,
                    objectItemSchema,
                    name,
                    index,
                    item.value as Record<string, unknown>,
                    (f, v) => updateField(index, f, v),
                  );
                  return (
                    <Control key={name} input={fieldInput} {...fieldProps} />
                  );
                })}
              </div>
            ) : (
              <Control
                input={buildItemInput(
                  props.input,
                  itemSchema,
                  index,
                  item.value,
                  (v) => updateItem(index, v),
                )}
                {...props.itemControlProps}
              />
            )}
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => handleRemove(index)}
            disabled={items.length <= min}
            aria-label="Remove"
          >
            <Trash2 className="size-4" />
          </Button>
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        onClick={handleAdd}
        disabled={items.length >= max}
        className="w-full border-dashed"
      >
        <Plus className="mr-2 size-4" />
        {props.addLabel ?? "Add"}
      </Button>
    </div>
  );

  if (props.variant === "plain") {
    return (
      <div className="flex flex-col gap-2">
        {meta.label && <p className="text-sm font-medium">{meta.label}</p>}
        {meta.description && (
          <p className="text-muted-foreground text-xs">{meta.description}</p>
        )}
        {list}
        {meta.error && <p className="text-destructive text-xs">{meta.error}</p>}
      </div>
    );
  }

  return (
    <fieldset className="border-border rounded-md border p-4">
      {meta.label && (
        <legend className="px-1 text-sm font-medium">{meta.label}</legend>
      )}
      <div className="flex flex-col gap-3">
        {meta.description && (
          <p className="text-muted-foreground text-xs">{meta.description}</p>
        )}
        {list}
        {meta.error && <p className="text-destructive text-xs">{meta.error}</p>}
      </div>
    </fieldset>
  );
}
