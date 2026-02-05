import {
  ActionIcon,
  Fieldset,
  Flex,
  Grid,
  Stack,
  Text,
  UnstyledButton,
} from "@mantine/core";
import { IconGripVertical, IconPlus, IconTrash } from "@tabler/icons-react";
import type { TObject, TSchema } from "alepha";
import { useAlepha } from "alepha/react";
import type { BaseInputField } from "alepha/react/form";
import { useCallback, useEffect, useRef, useState } from "react";
import { ui } from "../../constants/ui.ts";
import {
  type GenericControlProps,
  parseInput,
} from "../../utils/parseInput.ts";
import Control, { type ControlProps } from "./Control.tsx";

/**
 * Represents an array item with a stable key for React reconciliation.
 */
interface ArrayItem {
  key: number;
  value: any;
}

export interface ControlArrayProps extends GenericControlProps {
  /**
   * Minimum number of items allowed.
   * @default 0
   */
  min?: number;

  /**
   * Maximum number of items allowed.
   * @default Infinity
   */
  max?: number;

  /**
   * Label for the add button.
   * @default "Add item"
   */
  addLabel?: string;

  /**
   * Number of columns for object item fields.
   * @default 1
   */
  columns?: number;

  /**
   * Variant for the container.
   * - "fieldset": Uses Mantine Fieldset with legend
   * - "plain": No container, just renders items
   * @default "fieldset"
   */
  variant?: "fieldset" | "plain";

  /**
   * Per-field control props override for object items.
   * Keys are field names from the item schema.
   */
  controlProps?: Record<string, Partial<Omit<ControlProps, "input">>>;

  /**
   * Control props for primitive items.
   */
  itemControlProps?: Partial<Omit<ControlProps, "input">>;

  /**
   * Show drag handle for reordering.
   * @default false
   */
  sortable?: boolean;
}

/**
 * Custom hook to sync array items with form state.
 * Uses form events as the source of truth, eliminating dual-state issues.
 */
const useArrayItems = (
  input: BaseInputField | undefined,
): {
  items: ArrayItem[];
  setItems: (items: ArrayItem[]) => void;
  nextKey: () => number;
} => {
  const alepha = useAlepha();
  const keyCounter = useRef(0);

  // Initialize from defaultValue
  const [items, setItemsState] = useState<ArrayItem[]>(() => {
    const defaultValue = input?.props?.defaultValue;
    if (Array.isArray(defaultValue)) {
      return defaultValue.map((value) => ({
        key: keyCounter.current++,
        value,
      }));
    }
    return [];
  });

  // Sync form value to local state
  const syncFromFormValue = useCallback((formValue: any[] | undefined) => {
    if (!Array.isArray(formValue)) {
      setItemsState([]);
      return;
    }

    // Preserve keys for existing items where possible
    setItemsState((prevItems) => {
      // If lengths match and values are same references, keep existing keys
      if (prevItems.length === formValue.length) {
        const allSame = prevItems.every(
          (item, i) => item.value === formValue[i],
        );
        if (allSame) return prevItems;
      }

      // Otherwise, create new items with fresh keys
      keyCounter.current = 0;
      return formValue.map((value) => ({
        key: keyCounter.current++,
        value,
      }));
    });
  }, []);

  // Listen for form changes and reset events
  useEffect(() => {
    if (!input?.form) return;

    const formId = input.form.id;
    const fieldPath = input.path;

    const listeners = [
      // Handle form reset
      alepha.events.on("form:reset", (event) => {
        if (event.id === formId) {
          const defaultValue = input.props?.defaultValue;
          keyCounter.current = 0;
          if (Array.isArray(defaultValue)) {
            setItemsState(
              defaultValue.map((value) => ({
                key: keyCounter.current++,
                value,
              })),
            );
          } else {
            setItemsState([]);
          }
        }
      }),

      // Handle external value changes (e.g., programmatic updates)
      alepha.events.on("form:change", (event) => {
        if (event.id === formId && event.path === fieldPath) {
          // Value was changed externally, sync our state
          syncFromFormValue(event.value);
        }
      }),
    ];

    return () => {
      for (const unsub of listeners) {
        unsub();
      }
    };
  }, [alepha, input, syncFromFormValue]);

  // Update form when items change
  const setItems = useCallback(
    (newItems: ArrayItem[]) => {
      setItemsState(newItems);
      // Update form value - this will trigger form:change but we'll detect it's from us
      input?.set(newItems.map((item) => item.value));
    },
    [input],
  );

  const nextKey = useCallback(() => keyCounter.current++, []);

  return { items, setItems, nextKey };
};

/**
 * Creates a proper InputField for an array item that integrates with the form system.
 * Uses array index for test IDs to ensure predictable, testable element identifiers.
 */
const createArrayItemInput = (
  parentInput: BaseInputField,
  itemSchema: TSchema,
  index: number,
  _itemKey: number,
  value: any,
  onValueChange: (value: any) => void,
): BaseInputField => {
  return {
    schema: itemSchema,
    path: `${parentInput.path}/${index}`,
    required: false,
    form: parentInput.form,
    props: {
      id: `${parentInput.props.id}-${index}`,
      name: `${parentInput.props.name}[${index}]`,
      defaultValue: value,
    },
    set: onValueChange,
  };
};

/**
 * Creates a proper InputField for a nested object field within an array item.
 * Uses array index for test IDs to ensure predictable, testable element identifiers.
 */
const createArrayItemFieldInput = (
  parentInput: BaseInputField,
  itemSchema: TObject,
  fieldName: string,
  index: number,
  _itemKey: number,
  itemValue: any,
  onFieldChange: (field: string, value: any) => void,
): BaseInputField => {
  const fieldSchema = itemSchema.properties[fieldName];
  return {
    schema: fieldSchema,
    path: `${parentInput.path}/${index}/${fieldName}`,
    required: itemSchema.required?.includes(fieldName) ?? false,
    form: parentInput.form,
    props: {
      id: `${parentInput.props.id}-${index}-${fieldName}`,
      name: `${parentInput.props.name}[${index}].${fieldName}`,
      defaultValue: itemValue?.[fieldName],
    },
    set: (value: any) => onFieldChange(fieldName, value),
  };
};

/**
 * ControlArray component for editing arrays of schema items.
 *
 * Features:
 * - Dynamic add/remove of items
 * - Supports arrays of objects with nested fields
 * - Supports arrays of primitives
 * - Grid layout for object items
 * - Min/max constraints
 * - Syncs with form state (handles external updates and resets)
 *
 * @example
 * ```tsx
 * // For a schema like:
 * // t.object({
 * //   contacts: t.array(t.object({
 * //     name: t.text(),
 * //     email: t.text({ format: "email" }),
 * //   }))
 * // })
 *
 * <ControlArray
 *   input={form.input.contacts}
 *   columns={2}
 *   addLabel="Add contact"
 *   controlProps={{
 *     email: { text: { placeholder: "email@example.com" } }
 *   }}
 * />
 * ```
 */
const ControlArray = (props: ControlArrayProps) => {
  const { inputProps } = parseInput(props, {});
  const { items, setItems, nextKey } = useArrayItems(props.input);

  if (!props.input?.props) {
    return null;
  }

  const schema = props.input.schema;
  if (!schema || !("items" in schema)) {
    return null;
  }

  const itemSchema = (schema as { items: TSchema }).items;
  const isObjectItem = itemSchema && "properties" in itemSchema;
  const { min = 0, max = Number.POSITIVE_INFINITY, columns = 1 } = props;

  const handleAdd = () => {
    if (items.length >= max) return;

    // Create default value based on item schema
    let newValue: any;
    if (isObjectItem) {
      newValue = {};
      // Initialize with default values from schema if available
      const objSchema = itemSchema as TObject;
      for (const [key, propSchema] of Object.entries(objSchema.properties)) {
        if ("default" in propSchema) {
          newValue[key] = propSchema.default;
        }
      }
    } else {
      newValue = "";
    }

    setItems([...items, { key: nextKey(), value: newValue }]);
  };

  const handleRemove = (index: number) => {
    if (items.length <= min) return;
    setItems(items.filter((_, i) => i !== index));
  };

  const handleItemChange = (index: number, value: any) => {
    const newItems = [...items];
    newItems[index] = { ...newItems[index], value };
    setItems(newItems);
  };

  const handleFieldChange = (index: number, field: string, value: any) => {
    const newItems = [...items];
    newItems[index] = {
      ...newItems[index],
      value: { ...newItems[index].value, [field]: value },
    };
    setItems(newItems);
  };

  const colSpan = 12 / columns;
  const objectItemSchema = isObjectItem ? (itemSchema as TObject) : null;
  const fieldNames = objectItemSchema
    ? Object.keys(objectItemSchema.properties)
    : [];

  const renderItems = () => (
    <Stack gap="sm">
      {items.map((item, index) => (
        <Flex
          key={item.key}
          gap="sm"
          align="flex-start"
          p="xs"
          bg={ui.colors.surface}
          style={{ borderRadius: "var(--mantine-radius-sm)" }}
        >
          {props.sortable && (
            <ActionIcon
              variant="subtle"
              color="gray"
              style={{ cursor: "grab" }}
            >
              <IconGripVertical size={16} />
            </ActionIcon>
          )}

          {objectItemSchema ? (
            <Grid style={{ flex: 1 }} gutter="sm">
              {fieldNames.map((fieldName) => {
                const fieldControlProps = props.controlProps?.[fieldName] ?? {};
                const fieldInput = createArrayItemFieldInput(
                  props.input,
                  objectItemSchema,
                  fieldName,
                  index,
                  item.key,
                  item.value,
                  (field, value) => handleFieldChange(index, field, value),
                );

                return (
                  <Grid.Col key={fieldName} span={colSpan}>
                    <Control input={fieldInput} {...fieldControlProps} />
                  </Grid.Col>
                );
              })}
            </Grid>
          ) : (
            <Flex style={{ flex: 1 }}>
              <Control
                input={createArrayItemInput(
                  props.input,
                  itemSchema,
                  index,
                  item.key,
                  item.value,
                  (value) => handleItemChange(index, value),
                )}
                {...props.itemControlProps}
              />
            </Flex>
          )}

          <ActionIcon
            variant="subtle"
            color="red"
            onClick={() => handleRemove(index)}
            disabled={items.length <= min}
          >
            <IconTrash size={16} />
          </ActionIcon>
        </Flex>
      ))}

      <UnstyledButton
        onClick={handleAdd}
        disabled={items.length >= max}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 6,
          padding: "8px 12px",
          borderRadius: "var(--mantine-radius-sm)",
          border: "1px dashed var(--mantine-color-dimmed)",
          color: "var(--mantine-color-dimmed)",
          fontSize: "var(--mantine-font-size-sm)",
          cursor: items.length >= max ? "not-allowed" : "pointer",
          opacity: items.length >= max ? 0.5 : 1,
          transition: "all 150ms ease",
        }}
        onMouseEnter={(e) => {
          if (items.length < max) {
            e.currentTarget.style.borderColor =
              "var(--mantine-color-blue-filled)";
            e.currentTarget.style.color = "var(--mantine-color-blue-filled)";
            e.currentTarget.style.background =
              "var(--mantine-color-blue-light)";
          }
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.borderColor = "var(--mantine-color-dimmed)";
          e.currentTarget.style.color = "var(--mantine-color-dimmed)";
          e.currentTarget.style.background = "transparent";
        }}
      >
        <IconPlus size={14} />
        {props.addLabel ?? "Add"}
      </UnstyledButton>
    </Stack>
  );

  if (props.variant === "plain") {
    return (
      <Stack gap="xs">
        {inputProps.label && (
          <Text size="sm" fw={500}>
            {inputProps.label}
          </Text>
        )}
        {inputProps.description && (
          <Text size="sm" c="dimmed">
            {inputProps.description}
          </Text>
        )}
        {renderItems()}
        {inputProps.error && (
          <Text size="sm" c="red">
            {inputProps.error}
          </Text>
        )}
      </Stack>
    );
  }

  return (
    <Fieldset legend={inputProps.label}>
      <Stack gap="xs">
        {inputProps.description && (
          <Text size="sm" c="dimmed">
            {inputProps.description}
          </Text>
        )}
        {renderItems()}
        {inputProps.error && (
          <Text size="sm" c="red">
            {inputProps.error}
          </Text>
        )}
      </Stack>
    </Fieldset>
  );
};

export default ControlArray;
