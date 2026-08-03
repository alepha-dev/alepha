import * as React from "react";

void React;

import {
  Control,
  type ControlProps,
} from "@alepha/ui/components/control/control";
import { Button } from "@alepha/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@alepha/ui/components/ui/dialog";
import { type ZObject, type ZType, z } from "alepha";
import { useAlepha } from "alepha/react";
import {
  type BaseInputField,
  parseField,
  unionVariants,
  useFormState,
} from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  Plus,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  childI18nPrefix,
  resolveFieldI18n,
} from "../control-base/field-i18n.ts";

interface ArrayItem {
  key: number;
  value: unknown;
}

export interface ControlArrayProps {
  /**
   * Bound array `InputField` from `useForm`.
   */
  input: BaseInputField;
  /**
   * Dictionary prefix for the item fields: each reads `<prefix>.<field>` and
   * `<prefix>.<field>.desc` (the index is not part of the key — every row of
   * the list shares one label).
   */
  i18nPrefix?: string;
  /**
   * Field label. Falls back to schema `title`.
   */
  label?: string;
  /**
   * Helper text shown below the array.
   */
  description?: string;
  /**
   * Minimum number of items (Add button disables when reached).
   */
  min?: number;
  /**
   * Maximum number of items (Add button disables when reached).
   */
  max?: number;
  /**
   * Override the "Add item" button label.
   */
  addLabel?: string;
  /**
   * Number of grid columns for each item's inner fields.
   */
  columns?: 1 | 2 | 3 | 4;
  /**
   * "fieldset" wraps in a bordered container with legend; "plain" renders items only.
   */
  variant?: "fieldset" | "plain";
  /**
   * Per-field `<Control>` overrides for items, keyed by inner field name.
   */
  controlProps?: Record<string, Partial<Omit<ControlProps, "input">>>;
  /**
   * Override props applied to every item (when items are primitive, not objects).
   */
  itemControlProps?: Partial<Omit<ControlProps, "input">>;
  /**
   * Disable add/remove and all inner controls.
   */
  disabled?: boolean;

  /**
   * Default expanded state. @default true
   */
  defaultExpanded?: boolean;

  /**
   * Confirm before deleting an item. Pass `true` for default copy or an
   * object to override title/message.
   */
  confirmDelete?: boolean | { title?: string; message?: string };

  /**
   * Compute the visible label for each item header (and tab name in tabs mode).
   */
  renderTabName?: (i: number, value: unknown) => string;

  /**
   * Force tabs mode even for short arrays. Default heuristic: items > 4 OR nested object/array fields.
   */
  forceTabs?: boolean;
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

/**
 * Discriminated-union support for item schemas.
 *
 * `z.array(z.union([...objects]))` is how a heterogeneous list is spelled. The
 * variants almost always differ by one literal property (`kind`, `type`, …),
 * which is enough to (a) tell which variant an existing item is and (b) label
 * the choice offered when adding one. Everything below degrades quietly: no
 * union, or no discriminant, and the array behaves exactly as before.
 */
const objectVariants = (itemSchema: ZType): ZObject[] | null => {
  const variants = unionVariants(itemSchema);
  if (!variants?.length) return null;
  const objects = variants
    .map((variant) => z.schema.unwrap(variant))
    .filter((variant) => z.schema.isObject(variant)) as ZObject[];
  return objects.length === variants.length ? objects : null;
};

/** The property whose value identifies the variant (a literal in every variant). */
const discriminantOf = (variants: ZObject[]): string | null => {
  const [first] = variants;
  if (!first) return null;
  for (const name of Object.keys(z.schema.shape(first))) {
    const values = variants.map((variant) =>
      literalValueOf(z.schema.shape(variant)[name]),
    );
    if (values.every((value) => typeof value === "string")) {
      const unique = new Set(values as string[]);
      if (unique.size === variants.length) return name;
    }
  }
  return null;
};

/** The single allowed value of a literal/const schema, if it is one. */
const literalValueOf = (schema: unknown): unknown => {
  if (!schema) return undefined;
  const inner = z.schema.unwrap(schema as ZType) as {
    const?: unknown;
    values?: unknown[] | Set<unknown>;
    _zod?: { def?: { values?: unknown[] } };
  };
  if (inner?.const !== undefined) return inner.const;
  // zod spells a literal's allowed values as `_zod.def.values` (an array);
  // the public `.values` is a Set, so normalise both.
  const raw = inner?._zod?.def?.values ?? inner?.values;
  const values =
    raw instanceof Set ? [...raw] : Array.isArray(raw) ? raw : undefined;
  return values?.length === 1 ? values[0] : undefined;
};

/** Label for a variant: its discriminant value, else its index. */
const variantLabel = (
  variant: ZObject,
  discriminant: string | null,
  index: number,
): string => {
  const value = discriminant
    ? literalValueOf(z.schema.shape(variant)[discriminant])
    : undefined;
  return typeof value === "string" ? value : `#${index + 1}`;
};

const buildItemInput = (
  parent: BaseInputField,
  schema: ZType,
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
  itemSchema: ZObject,
  fieldName: string,
  index: number,
  itemValue: Record<string, unknown> | undefined,
  onFieldChange: (field: string, value: unknown) => void,
): BaseInputField => ({
  schema: z.schema.shape(itemSchema)[fieldName],
  path: `${parent.path}/${index}/${fieldName}`,
  required: z.schema.requiredKeys(itemSchema).includes(fieldName),
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
  const { tr } = useI18n();
  const { items, setItems, nextKey } = useArrayItems(props.input);
  const [expanded, setExpanded] = useState(props.defaultExpanded ?? true);
  const [activeTab, setActiveTab] = useState(0);
  const [pendingDelete, setPendingDelete] = useState<number | null>(null);

  if (!props.input?.props) return null;

  const meta = parseField(props.input, {
    label: props.label,
    description: props.description,
    error: form.error,
  });

  const schema = props.input.schema;
  // `isArray`, not `"items" in schema`: that spelling tested for a prototype
  // alias rather than for an array schema, so it answered false once the alias
  // went away — and the whole control rendered nothing, Add button included.
  if (!z.schema.isArray(schema)) return null;

  // `z.schema.element`, not `.items`: the latter only ever resolved through a
  // prototype alias on ZodArray, so it silently became `undefined` — and with
  // no item schema the control renders neither fields nor tabs.
  const itemSchema = z.schema.element(schema) as ZType;
  const variants = objectVariants(itemSchema);
  const discriminant = variants ? discriminantOf(variants) : null;

  /**
   * The object schema to edit an item with. For a union that is the variant the
   * item's discriminant points at (first variant as a fallback, e.g. a freshly
   * added item), so each row renders exactly its own fields.
   */
  const schemaForValue = (value: unknown): ZObject | null => {
    if (!variants) {
      // `isObject`, not `"properties" in itemSchema`: the latter tested for a
      // prototype alias, so it answered false as soon as the alias went away.
      return z.schema.isObject(itemSchema) ? (itemSchema as ZObject) : null;
    }
    if (discriminant && value && typeof value === "object") {
      const tag = (value as Record<string, unknown>)[discriminant];
      const match = variants.find(
        (variant) =>
          literalValueOf(z.schema.shape(variant)[discriminant]) === tag,
      );
      if (match) return match;
    }
    return variants[0] ?? null;
  };

  const objectItemSchema = schemaForValue(items[0]?.value);
  const fieldNames = objectItemSchema
    ? Object.keys(z.schema.shape(objectItemSchema))
    : [];

  // Schema-driven max/min if present
  const schemaMax = (schema as { maxItems?: number }).maxItems;
  const schemaMin = (schema as { minItems?: number }).minItems;
  const min = props.min ?? schemaMin ?? 0;
  const max = props.max ?? schemaMax ?? Number.POSITIVE_INFINITY;
  const columns = props.columns ?? 1;

  // Tabs heuristic: forced or nested complex item or many items
  const hasComplexFields = objectItemSchema
    ? fieldNames.some((n) => {
        const p = z.schema.shape(objectItemSchema)[n] as { type?: string };
        return p?.type === "object" || p?.type === "array";
      })
    : false;
  const useTabs =
    props.forceTabs ||
    (objectItemSchema && (items.length > 4 || hasComplexFields));

  const handleAdd = (variantIndex = 0) => {
    if (items.length >= max) return;
    const shape = variants ? variants[variantIndex] : objectItemSchema;
    let value: unknown;
    if (shape) {
      value = {};
      for (const [k, p] of Object.entries(z.schema.shape(shape))) {
        const def = z.schema.getDefault(p);
        if (def !== undefined) (value as Record<string, unknown>)[k] = def;
        // Stamp the discriminant so the new item resolves to its variant.
        const literal = literalValueOf(p);
        if (literal !== undefined)
          (value as Record<string, unknown>)[k] = literal;
      }
    } else {
      value = "";
    }
    setItems([...items, { key: nextKey(), value }]);
    if (useTabs) setActiveTab(items.length);
  };

  const handleRemove = (index: number) => {
    if (items.length <= min) return;
    if (props.confirmDelete) {
      setPendingDelete(index);
      return;
    }
    doRemove(index);
  };

  const doRemove = (index: number) => {
    setItems(items.filter((_, i) => i !== index));
    if (useTabs)
      setActiveTab(Math.max(0, Math.min(activeTab, items.length - 2)));
  };

  const handleMove = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= items.length) return;
    const next = [...items];
    [next[index], next[target]] = [next[target], next[index]];
    setItems(next);
    if (useTabs) setActiveTab(target);
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

  const tabName = (i: number): string => {
    if (props.renderTabName) {
      try {
        return props.renderTabName(i, items[i]?.value);
      } catch {
        // fall through
      }
    }
    const value = items[i]?.value as Record<string, unknown> | undefined;
    const tag = discriminant ? value?.[discriminant] : undefined;
    if (typeof tag === "string") return `${tag} #${i + 1}`;
    return `${meta.label} #${i + 1}`;
  };

  const renderItemBody = (item: ArrayItem, index: number) => {
    // Resolved per item: in a union each row may be a different variant.
    const itemObjectSchema = schemaForValue(item.value);
    const itemFieldNames = itemObjectSchema
      ? Object.keys(z.schema.shape(itemObjectSchema))
      : [];
    return itemObjectSchema ? (
      <div className={`grid gap-3 ${colsClass[columns]}`}>
        {itemFieldNames.map((name) => {
          const fieldProps = {
            ...(props.controlProps?.[name] ?? {}),
            ...resolveFieldI18n(
              tr as never,
              props.i18nPrefix,
              name,
              props.controlProps?.[name] ?? {},
            ),
            i18nPrefix: childI18nPrefix(props.i18nPrefix, name),
          };
          // The discriminant decides the item's SHAPE — editing it would
          // invalidate every sibling field, so it is shown read-only.
          const isDiscriminant = !!variants && name === discriminant;
          const fieldInput = buildFieldInput(
            props.input,
            itemObjectSchema,
            name,
            index,
            item.value as Record<string, unknown>,
            (f, v) => updateField(index, f, v),
          );
          return (
            <Control
              key={name}
              input={fieldInput}
              disabled={props.disabled || isDiscriminant}
              {...fieldProps}
            />
          );
        })}
      </div>
    ) : (
      <Control
        input={buildItemInput(props.input, itemSchema, index, item.value, (v) =>
          updateItem(index, v),
        )}
        disabled={props.disabled}
        {...props.itemControlProps}
      />
    );
  };

  const itemActions = (index: number) => (
    <div className="flex shrink-0 flex-col gap-1">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-7"
        disabled={props.disabled || index === 0 || items.length < 2}
        onClick={() => handleMove(index, -1)}
        aria-label={tr("controlArray.moveUp", { default: "Move up" })}
      >
        <ArrowUp className="size-3.5" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-7"
        disabled={props.disabled || items.length <= min}
        onClick={() => handleRemove(index)}
        aria-label={tr("controlArray.remove", { default: "Remove" })}
      >
        <Trash2 className="size-3.5" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-7"
        disabled={
          props.disabled || index === items.length - 1 || items.length < 2
        }
        onClick={() => handleMove(index, 1)}
        aria-label={tr("controlArray.moveDown", { default: "Move down" })}
      >
        <ArrowDown className="size-3.5" />
      </Button>
    </div>
  );

  const flatList = (
    <div className="flex flex-col gap-2">
      {items.map((item, index) => (
        <div
          key={item.key}
          className="bg-muted/30 flex items-start gap-2 rounded-md border p-3"
        >
          <div className="flex-1 min-w-0">{renderItemBody(item, index)}</div>
          {itemActions(index)}
        </div>
      ))}
    </div>
  );

  const tabs = useTabs && items.length > 0 && (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-1 border-b pb-1">
        {items.map((item, i) => (
          <Button
            key={item.key}
            type="button"
            variant={i === activeTab ? "default" : "ghost"}
            size="sm"
            onClick={() => setActiveTab(i)}
          >
            {tabName(i)}
          </Button>
        ))}
      </div>
      {items[activeTab] && (
        <div className="bg-muted/30 flex items-start gap-2 rounded-md border p-3">
          <div className="flex-1 min-w-0">
            {renderItemBody(items[activeTab], activeTab)}
          </div>
          {itemActions(activeTab)}
        </div>
      )}
    </div>
  );

  const list = (
    <div className="flex flex-col gap-2">{useTabs ? tabs : flatList}</div>
  );

  const headerControls = (
    <div className="flex items-start gap-3">
      {variants && variants.length > 1 ? (
        // A union offers a choice of shapes: one Add button per variant,
        // labelled by its discriminant ("single", "period_pass", …).
        <div className="flex shrink-0 flex-wrap gap-1">
          {variants.map((variant, index) => (
            <Button
              key={variantLabel(variant, discriminant, index)}
              type="button"
              variant="outline"
              size="sm"
              className="h-8"
              disabled={props.disabled || items.length >= max}
              onClick={() => handleAdd(index)}
            >
              <Plus className="size-3.5" />
              {variantLabel(variant, discriminant, index)}
            </Button>
          ))}
        </div>
      ) : (
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="size-8 shrink-0"
          disabled={props.disabled || items.length >= max}
          onClick={() => handleAdd()}
          aria-label={
            props.addLabel ?? tr("controlArray.add", { default: "Add" })
          }
        >
          <Plus className="size-4" />
        </Button>
      )}
      <div className="flex flex-col min-w-0 flex-1">
        <div className="text-sm font-medium leading-tight">
          {meta.label}
          {meta.required && <span className="text-destructive ml-0.5">*</span>}
          <span className="text-muted-foreground ml-2 text-xs">
            ({items.length})
          </span>
        </div>
        {meta.description && (
          <p className="text-muted-foreground text-xs leading-tight">
            {meta.description}
          </p>
        )}
        {meta.error && (
          <p className="text-destructive text-xs leading-tight">{meta.error}</p>
        )}
      </div>
      {items.length > 0 && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-8 shrink-0"
          aria-label={
            expanded
              ? tr("controlArray.collapse", { default: "Collapse" })
              : tr("controlArray.expand", { default: "Expand" })
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
  );

  const confirmContent = (() => {
    if (pendingDelete == null) return null;
    const cd = props.confirmDelete;
    const title =
      typeof cd === "object"
        ? (cd.title ??
          tr("controlArray.deleteTitle", { default: "Delete item" }))
        : tr("controlArray.deleteTitle", { default: "Delete item" });
    const message =
      typeof cd === "object"
        ? (cd.message ??
          tr("controlArray.deleteConfirm", {
            default: "Are you sure you want to delete this item?",
          }))
        : tr("controlArray.deleteConfirm", {
            default: "Are you sure you want to delete this item?",
          });
    return (
      <Dialog
        open={pendingDelete != null}
        onOpenChange={(v) => !v && setPendingDelete(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{message}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setPendingDelete(null)}>
              {tr("controlArray.cancel", { default: "Cancel" })}
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                doRemove(pendingDelete);
                setPendingDelete(null);
              }}
            >
              {tr("controlArray.delete", { default: "Delete" })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  })();

  if (props.variant === "plain") {
    return (
      <div className="flex flex-col gap-2">
        {headerControls}
        {expanded && items.length > 0 && list}
        {confirmContent}
      </div>
    );
  }

  return (
    <fieldset
      className={`rounded-md border p-3 ${
        meta.error ? "border-destructive" : "border-border"
      }`}
    >
      {headerControls}
      {expanded && items.length > 0 && <div className="mt-3">{list}</div>}
      {confirmContent}
    </fieldset>
  );
}
