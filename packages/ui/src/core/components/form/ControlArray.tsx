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
import { useEvents } from "alepha/react";
import type { BaseInputField } from "alepha/react/form";
import { useRef, useState } from "react";
import { ui } from "../../constants/ui.ts";
import {
  type GenericControlProps,
  parseInput,
} from "../../utils/parseInput.ts";
import Control, { type ControlProps } from "./Control.tsx";

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
 * ControlArray component for editing arrays of schema items.
 *
 * Features:
 * - Dynamic add/remove of items
 * - Supports arrays of objects with nested fields
 * - Supports arrays of primitives
 * - Grid layout for object items
 * - Min/max constraints
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
  const idCounter = useRef(0);

  // Initialize items with unique keys for React
  const [items, setItems] = useState<Array<{ key: number; value: any }>>(() => {
    const defaultValue = props.input?.props?.defaultValue;
    if (Array.isArray(defaultValue)) {
      return defaultValue.map((value) => ({
        key: idCounter.current++,
        value,
      }));
    }
    return [];
  });

  // Listen for form reset events
  useEvents(
    {
      "form:reset": (event) => {
        if (event.id === props.input?.form?.id) {
          const defaultValue = props.input?.props?.defaultValue;
          if (Array.isArray(defaultValue)) {
            idCounter.current = 0;
            setItems(
              defaultValue.map((value) => ({
                key: idCounter.current++,
                value,
              })),
            );
          } else {
            setItems([]);
          }
        }
      },
    },
    [props.input],
  );

  if (!props.input?.props) {
    return null;
  }

  const schema = props.input.schema;
  if (!schema || !("items" in schema)) {
    return null;
  }

  const itemSchema = (schema as any).items as TSchema;
  const isObjectItem = itemSchema && "properties" in itemSchema;
  const { min = 0, max = Number.POSITIVE_INFINITY, columns = 1 } = props;

  const updateFormValue = (newItems: Array<{ key: number; value: any }>) => {
    props.input.set(newItems.map((item) => item.value));
  };

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

    const newItems = [...items, { key: idCounter.current++, value: newValue }];
    setItems(newItems);
    updateFormValue(newItems);
  };

  const handleRemove = (index: number) => {
    if (items.length <= min) return;
    const newItems = items.filter((_, i) => i !== index);
    setItems(newItems);
    updateFormValue(newItems);
  };

  const handleItemChange = (index: number, value: any) => {
    const newItems = [...items];
    newItems[index] = { ...newItems[index], value };
    setItems(newItems);
    updateFormValue(newItems);
  };

  const handleFieldChange = (index: number, field: string, value: any) => {
    const newItems = [...items];
    newItems[index] = {
      ...newItems[index],
      value: { ...newItems[index].value, [field]: value },
    };
    setItems(newItems);
    updateFormValue(newItems);
  };

  const colSpan = 12 / columns;
  const fieldNames = isObjectItem
    ? Object.keys((itemSchema as TObject).properties)
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

          {isObjectItem ? (
            <Grid style={{ flex: 1 }} gutter="sm">
              {fieldNames.map((fieldName) => {
                const fieldSchema = (itemSchema as TObject).properties[
                  fieldName
                ];
                const fieldControlProps = props.controlProps?.[fieldName] ?? {};

                // Create a virtual InputField for the nested property
                const virtualInput: BaseInputField = {
                  schema: fieldSchema,
                  props: {
                    id: `${props.input.props.id}-${item.key}-${fieldName}`,
                    name: `${props.input.props.name}[${index}].${fieldName}`,
                    defaultValue: item.value?.[fieldName],
                  },
                  path: `${props.input.path}/${index}/${fieldName}`,
                  required:
                    (itemSchema as TObject).required?.includes(fieldName) ??
                    false,
                  form: props.input.form,
                  set: (value: any) =>
                    handleFieldChange(index, fieldName, value),
                };

                return (
                  <Grid.Col key={fieldName} span={colSpan}>
                    <Control input={virtualInput} {...fieldControlProps} />
                  </Grid.Col>
                );
              })}
            </Grid>
          ) : (
            <Flex style={{ flex: 1 }}>
              <Control
                input={
                  {
                    schema: itemSchema,
                    props: {
                      id: `${props.input.props.id}-${item.key}`,
                      name: `${props.input.props.name}[${index}]`,
                      defaultValue: item.value,
                    },
                    path: `${props.input.path}/${index}`,
                    required: false,
                    form: props.input.form,
                    set: (value: any) => handleItemChange(index, value),
                  } as BaseInputField
                }
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
