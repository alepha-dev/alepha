import { Fieldset, Flex, Grid, Text } from "@mantine/core";
import type { TObject } from "alepha";
import type { BaseInputField, ObjectInputField } from "alepha/react/form";
import { type GenericControlProps, parseInput } from "../utils/parseInput.ts";
import Control, { type ControlProps } from "./Control.tsx";

export interface ControlObjectProps extends GenericControlProps {
  /**
   * Number of columns for the grid layout.
   * @default 1
   */
  columns?: number;

  /**
   * Variant for the container.
   * - "fieldset": Uses Mantine Fieldset with legend
   * - "plain": No container, just renders fields
   * @default "fieldset"
   */
  variant?: "fieldset" | "plain";

  /**
   * Per-field control props override.
   * Keys are field names from the schema.
   */
  controlProps?: Record<string, Partial<Omit<ControlProps, "input">>>;
}

/**
 * ControlObject component for editing nested object schemas.
 *
 * Features:
 * - Renders all properties of an object schema
 * - Supports grid layout with configurable columns
 * - Per-field customization via controlProps
 * - Recursive support for deeply nested objects
 *
 * The form system provides nested InputFields under the `.items` property.
 * For example: form.input.address.items.street
 *
 * @example
 * ```tsx
 * // For a schema like:
 * // t.object({
 * //   address: t.object({
 * //     street: t.text(),
 * //     city: t.text(),
 * //     zip: t.text(),
 * //   })
 * // })
 *
 * <ControlObject
 *   input={form.input.address}
 *   columns={2}
 *   controlProps={{
 *     zip: { text: { maxLength: 10 } }
 *   }}
 * />
 * ```
 */
const ControlObject = (props: ControlObjectProps) => {
  const { inputProps } = parseInput(props, {});

  if (!props.input?.props) {
    return null;
  }

  const schema = props.input.schema as TObject;
  if (!schema?.properties) {
    return null;
  }

  const fieldNames = Object.keys(schema.properties);
  const columns = props.columns ?? 1;
  const colSpan = 12 / columns;

  // The form system provides nested InputFields under .items
  const objectInput = props.input as ObjectInputField<TObject>;
  const nestedItems = objectInput.items as Record<string, BaseInputField>;

  const renderFields = () => (
    <Grid>
      {fieldNames.map((fieldName) => {
        const fieldControlProps = props.controlProps?.[fieldName] ?? {};

        // Access nested InputField from .items
        const field = nestedItems?.[fieldName];
        if (!field) {
          return null;
        }

        return (
          <Grid.Col key={fieldName} span={colSpan}>
            <Control input={field} {...fieldControlProps} />
          </Grid.Col>
        );
      })}
    </Grid>
  );

  if (props.variant === "plain") {
    return renderFields();
  }

  return (
    <Fieldset legend={inputProps.label}>
      <Flex direction="column" gap="xs">
        {inputProps.description && (
          <Text size="sm" c="dimmed">
            {inputProps.description}
          </Text>
        )}
        {renderFields()}
        {inputProps.error && (
          <Text size="sm" c="red">
            {inputProps.error}
          </Text>
        )}
      </Flex>
    </Fieldset>
  );
};

export default ControlObject;
