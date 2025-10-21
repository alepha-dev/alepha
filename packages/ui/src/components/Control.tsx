import { TypeBoxError } from "@alepha/core";
import { type InputField, useFormState } from "@alepha/react-form";
import {
  Autocomplete,
  type AutocompleteProps,
  Flex,
  Input,
  PasswordInput,
  type PasswordInputProps,
  SegmentedControl,
  type SegmentedControlProps,
  type SelectProps,
  Switch,
  type SwitchProps,
  Textarea,
  type TextareaProps,
  TextInput,
  type TextInputProps,
} from "@mantine/core";
import type {
  DateInputProps,
  DateTimePickerProps,
  TimeInputProps,
} from "@mantine/dates";
import type { ComponentType, ReactNode } from "react";
import ControlDate from "./ControlDate";
import ControlSelect from "./ControlSelect";

export interface ControlProps {
  input: InputField;

  title?: string;
  description?: string;

  icon?: ReactNode;

  text?: TextInputProps;
  area?: boolean | TextareaProps;
  select?: boolean | SelectProps;
  autocomplete?: boolean | AutocompleteProps;
  password?: boolean | PasswordInputProps;
  switch?: boolean | SwitchProps;
  segmented?: boolean | Partial<SegmentedControlProps>;
  date?: boolean | DateInputProps;
  datetime?: boolean | DateTimePickerProps;
  time?: boolean | TimeInputProps;

  custom?: ComponentType<CustomControlProps>;
}

/**
 * Generic form control that renders the appropriate input based on the schema and props.
 *
 * Supports:
 * - TextInput
 * - Textarea
 * - Select (for enum types)
 * - Autocomplete
 * - PasswordInput
 * - Switch (for boolean types)
 * - SegmentedControl (for enum types)
 * - DateInput (for date format)
 * - DateTimePicker (for date-time format)
 * - TimeInput (for time format)
 * - Custom component
 *
 * Automatically handles labels, descriptions, error messages, and required state.
 */
const Control = (props: ControlProps) => {
  const form = useFormState(props.input);
  if (!props.input?.props) {
    return null;
  }

  // shared props

  const disabled = false; // form.loading;
  const id = props.input.props.id;
  const label =
    props.title ??
    ("title" in props.input.schema &&
    typeof props.input.schema.title === "string"
      ? props.input.schema.title
      : undefined) ??
    prettyName(props.input.path);
  const description =
    props.description ??
    ("description" in props.input.schema &&
    typeof props.input.schema.description === "string"
      ? props.input.schema.description
      : undefined);
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

  // -------------------------------------------------------------------------------------------------------------------

  if (props.custom) {
    const Custom = props.custom;
    return (
      <Input.Wrapper {...inputProps}>
        <Flex flex={1} mt={"calc(var(--mantine-spacing-xs) / 2)"}>
          <Custom
            defaultValue={props.input.props.defaultValue}
            onChange={(value) => {
              props.input.set(value);
            }}
          />
        </Flex>
      </Input.Wrapper>
    );
  }

  // region <SegmentedControl/>
  if (props.segmented) {
    const segmentedControlProps: Partial<SegmentedControlProps> =
      typeof props.segmented === "object" ? props.segmented : {};
    const data =
      segmentedControlProps.data ??
      (props.input.schema &&
      "enum" in props.input.schema &&
      Array.isArray(props.input.schema.enum)
        ? props.input.schema.enum?.map((value: string) => ({
            value,
            label: value,
          }))
        : []);
    return (
      <Input.Wrapper {...inputProps}>
        <Flex mt={"calc(var(--mantine-spacing-xs) / 2)"}>
          <SegmentedControl
            disabled={disabled}
            defaultValue={String(props.input.props.defaultValue)}
            {...segmentedControlProps}
            onChange={(value) => {
              props.input.set(value);
            }}
            data={data}
          />
        </Flex>
      </Input.Wrapper>
    );
  }
  // endregion

  // region <Autocomplete/>
  if (props.autocomplete) {
    const autocompleteProps =
      typeof props.autocomplete === "object" ? props.autocomplete : {};

    return (
      <Autocomplete
        {...inputProps}
        id={id}
        leftSection={icon}
        {...props.input.props}
        {...autocompleteProps}
      />
    );
  }
  // endregion

  // region <ControlSelect/>
  // Handle: single enum, array of enum, array of strings, or explicit select/multi/tags props
  const isEnum =
    props.input.schema &&
    "enum" in props.input.schema &&
    props.input.schema.enum;
  const isArray =
    props.input.schema &&
    "type" in props.input.schema &&
    props.input.schema.type === "array";
  const hasArrayItems =
    isArray && "items" in props.input.schema && props.input.schema.items;

  if (isEnum || isArray || props.select) {
    return (
      <ControlSelect
        input={props.input}
        title={props.title}
        description={props.description}
        icon={icon}
        select={props.select}
      />
    );
  }
  // endregion

  // region <Switch/>

  if (
    (props.input.schema &&
      "type" in props.input.schema &&
      props.input.schema.type === "boolean") ||
    props.switch
  ) {
    const switchProps = typeof props.switch === "object" ? props.switch : {};

    return (
      <Switch
        {...inputProps}
        id={id}
        color={"blue"}
        defaultChecked={props.input.props.defaultValue}
        {...props.input.props}
        {...switchProps}
      />
    );
  }
  // endregion

  // region <PasswordInput/>
  if (props.password || props.input.props.name?.includes("password")) {
    const passwordInputProps =
      typeof props.password === "object" ? props.password : {};
    return (
      <PasswordInput
        {...inputProps}
        id={id}
        leftSection={icon}
        {...props.input.props}
        {...passwordInputProps}
      />
    );
  }
  //endregion

  //region <Textarea/>
  if (props.area) {
    const textAreaProps = typeof props.area === "object" ? props.area : {};
    return (
      <Textarea
        {...inputProps}
        id={id}
        leftSection={icon}
        {...props.input.props}
        {...textAreaProps}
      />
    );
  }
  //endregion

  // region <ControlDate/>
  // Handle: date, date-time, and time formats
  const format =
    props.input.schema &&
    "format" in props.input.schema &&
    typeof props.input.schema.format === "string"
      ? props.input.schema.format
      : undefined;

  if (
    props.date ||
    props.datetime ||
    props.time ||
    format === "date" ||
    format === "date-time" ||
    format === "time"
  ) {
    return (
      <ControlDate
        input={props.input}
        title={props.title}
        description={props.description}
        icon={icon}
        date={props.date}
        datetime={props.datetime}
        time={props.time}
      />
    );
  }
  // endregion

  // region <TextInput/>
  const textInputProps = typeof props.text === "object" ? props.text : {};
  return (
    <TextInput
      {...inputProps}
      id={id}
      leftSection={icon}
      {...props.input.props}
      {...textInputProps}
    />
  );
  //endregion
};

export default Control;

const prettyName = (name: string) => {
  return capitalize(name.replaceAll("/", ""));
};

const capitalize = (str: string) => {
  return str.charAt(0).toUpperCase() + str.slice(1);
};

export type CustomControlProps = {
  defaultValue: any;
  onChange: (value: any) => void;
};
