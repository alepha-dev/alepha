import { useFormState } from "@alepha/react-form";
import {
  Autocomplete,
  type AutocompleteProps,
  Flex,
  Input,
  MultiSelect,
  type MultiSelectProps,
  SegmentedControl,
  type SegmentedControlProps,
  Select,
  type SelectProps,
  TagsInput,
  type TagsInputProps,
} from "@mantine/core";
import { useEffect, useState } from "react";
import {
  type GenericControlProps,
  parseInput,
} from "../../utils/parseInput.ts";

export type SelectValueLabel =
  | string
  | { value: string; label: string; icon?: string };

export interface ControlSelectProps extends GenericControlProps {
  select?: boolean | SelectProps;
  multi?: boolean | MultiSelectProps;
  tags?: boolean | TagsInputProps;
  autocomplete?: boolean | AutocompleteProps;
  segmented?: boolean | Partial<SegmentedControlProps>;

  loader?: () => Promise<SelectValueLabel[]>;
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
  const { inputProps, id, icon } = parseInput(props, form);

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

  const [data, setData] = useState<SelectValueLabel[]>([]);

  useEffect(() => {
    if (!props.input?.props) {
      return;
    }

    if (props.loader) {
      props.loader().then(setData);
    } else {
      setData(enumValues);
    }
  }, [props.input, props.loader]);

  if (!props.input?.props) {
    return null;
  }

  if (props.segmented) {
    const segmentedControlProps: Partial<SegmentedControlProps> =
      typeof props.segmented === "object" ? props.segmented : {};

    return (
      <Input.Wrapper {...inputProps}>
        <Flex>
          <SegmentedControl
            disabled={inputProps.disabled}
            defaultValue={String(props.input.props.defaultValue)}
            {...segmentedControlProps}
            onChange={(value) => {
              props.input.set(value);
            }}
            data={data.slice(0, 10)}
          />
        </Flex>
      </Input.Wrapper>
    );
  }

  if (props.autocomplete) {
    const autocompleteProps =
      typeof props.autocomplete === "object" ? props.autocomplete : {};

    return (
      <Autocomplete
        {...inputProps}
        id={id}
        leftSection={icon}
        data={data}
        {...props.input.props}
        {...autocompleteProps}
      />
    );
  }

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
