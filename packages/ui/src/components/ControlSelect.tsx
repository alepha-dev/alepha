import { TypeBoxError } from "@alepha/core";
import type { InputField } from "@alepha/react-form";
import { useFormState } from "@alepha/react-form";
import {
  MultiSelect,
  type MultiSelectProps,
  Select,
  type SelectProps,
  TagsInput,
  type TagsInputProps,
} from "@mantine/core";
import type { ReactNode } from "react";

export interface ControlSelectProps {
  input: InputField;

  title?: string;
  description?: string;
  icon?: ReactNode;

  select?: boolean | SelectProps;
  multi?: boolean | MultiSelectProps;
  tags?: boolean | TagsInputProps;
}

/**
 * ControlSelect component for handling Select, MultiSelect, and TagsInput.
 *
 * Features:
 * - Basic Select with enum support
 * - MultiSelect for array of enums
 * - TagsInput for array of strings (no enum)
 * - Future: Lazy loading
 * - Future: Searchable/filterable options
 * - Future: Custom option rendering
 *
 * Automatically detects enum values and array types from schema.
 */
const ControlSelect = (props: ControlSelectProps) => {
  const form = useFormState(props.input);

  if (!props.input?.props) {
    return null;
  }

  const disabled = false; // form.loading;
  const id = props.input.props.id;

  // Extract label from props or schema
  const label =
    props.title ??
    ("title" in props.input.schema &&
    typeof props.input.schema.title === "string"
      ? props.input.schema.title
      : undefined) ??
    prettyName(props.input.path);

  // Extract description from props or schema
  const description =
    props.description ??
    ("description" in props.input.schema &&
    typeof props.input.schema.description === "string"
      ? props.input.schema.description
      : undefined);

  // Extract error message
  const error =
    form.error && form.error instanceof TypeBoxError
      ? form.error.value.message
      : undefined;

  const icon = props.icon;
  const required = props.input.required;

  const inputProps = {
    label,
    description,
    error,
    required,
    disabled,
  };

  // Detect if schema is an array type
  const isArray =
    props.input.schema &&
    "type" in props.input.schema &&
    props.input.schema.type === "array";

  // For arrays, check if items have enum (MultiSelect) or not (TagsInput)
  let itemsEnum: string[] | undefined;
  if (isArray && "items" in props.input.schema && props.input.schema.items) {
    const items: any = props.input.schema.items;
    if ("enum" in items && Array.isArray(items.enum)) {
      itemsEnum = items.enum;
    }
  }

  // Extract enum values from schema (for non-array select)
  const enumValues =
    props.input.schema &&
    "enum" in props.input.schema &&
    Array.isArray(props.input.schema.enum)
      ? props.input.schema.enum
      : [];

  // region <TagsInput/> - for array of strings without enum
  if ((isArray && !itemsEnum) || props.tags) {
    const tagsInputProps = typeof props.tags === "object" ? props.tags : {};
    return (
      <TagsInput
        {...inputProps}
        id={id}
        leftSection={icon}
        defaultValue={
          Array.isArray(props.input.props.defaultValue)
            ? props.input.props.defaultValue
            : []
        }
        onChange={(value) => {
          props.input.set(value);
        }}
        {...tagsInputProps}
      />
    );
  }
  // endregion

  // region <MultiSelect/> - for array of enums
  if ((isArray && itemsEnum) || props.multi) {
    const data =
      itemsEnum?.map((value: string) => ({
        value,
        label: value,
      })) || [];

    const multiSelectProps = typeof props.multi === "object" ? props.multi : {};

    return (
      <MultiSelect
        {...inputProps}
        id={id}
        leftSection={icon}
        data={data}
        defaultValue={
          Array.isArray(props.input.props.defaultValue)
            ? props.input.props.defaultValue
            : []
        }
        onChange={(value) => {
          props.input.set(value);
        }}
        {...multiSelectProps}
      />
    );
  }
  // endregion

  // region <Select/> - for single enum value
  const data = enumValues.map((value: string) => ({
    value,
    label: value,
  }));

  const selectProps = typeof props.select === "object" ? props.select : {};

  return (
    <Select
      {...inputProps}
      id={id}
      leftSection={icon}
      data={data}
      {...props.input.props}
      {...selectProps}
    />
  );
  // endregion
};

export default ControlSelect;

const prettyName = (name: string) => {
  return capitalize(name.replaceAll("/", ""));
};

const capitalize = (str: string) => {
  return str.charAt(0).toUpperCase() + str.slice(1);
};
