import {
  Autocomplete,
  type AutocompleteProps,
  Flex,
  Input,
  MultiSelect,
  type MultiSelectProps,
  type NumberInputProps,
  PasswordInput,
  type PasswordInputProps,
  SegmentedControl,
  type SegmentedControlProps,
  Select,
  type SelectProps,
  type SliderProps,
  Switch,
  type SwitchProps,
  Textarea,
  type TextareaProps,
  TextInput,
  type TextInputProps,
} from "@mantine/core";
import { TypeBoxError } from "alepha";
import { type BaseInputField, useFormState } from "alepha/react/form";
import type { ComponentType, ReactNode } from "react";

export interface ControlProps {
  input: BaseInputField;

  title?: string;
  description?: string;

  icon?: ReactNode;

  text?: TextInputProps;
  area?: boolean | TextareaProps;
  select?: boolean | SelectProps;
  multi?: boolean | MultiSelectProps;
  autocomplete?: boolean | AutocompleteProps;
  password?: boolean | PasswordInputProps;
  switch?: boolean | SwitchProps;
  segmented?: boolean | Partial<SegmentedControlProps>;
  slider?: boolean | Partial<SliderProps>;
  number?: boolean | NumberInputProps;

  custom?: ComponentType<CustomControlProps>;
  size?: "xs" | "sm" | "md" | "lg" | "xl";
}

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

  // region <MultiSelect/>
  if (props.multi) {
    const multiSelectProps = typeof props.multi === "object" ? props.multi : {};
    return (
      <MultiSelect
        {...inputProps}
        size={props.size}
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
        {...multiSelectProps}
      />
    );
  }
  // endregion

  // region <Select/>
  if (
    (props.input.schema &&
      "enum" in props.input.schema &&
      props.input.schema.enum) ||
    props.select
  ) {
    const data =
      props.input.schema &&
      "enum" in props.input.schema &&
      Array.isArray(props.input.schema.enum)
        ? props.input.schema.enum?.map((value: string) => ({
            value,
            label: value,
          }))
        : [];

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
  if (props.password) {
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
