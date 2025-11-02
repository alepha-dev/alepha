import { useFormState } from "@alepha/react-form";
import {
  ColorInput,
  type ColorInputProps,
  FileInput,
  type FileInputProps,
  Flex,
  Input,
  NumberInput,
  type NumberInputProps,
  PasswordInput,
  type PasswordInputProps,
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
import type { ComponentType } from "react";
import {
  type GenericControlProps,
  parseInput,
} from "../../utils/parseInput.ts";
import ControlDate from "./ControlDate.tsx";
import ControlSelect, { type ControlSelectProps } from "./ControlSelect.tsx";

export interface ControlProps extends GenericControlProps {
  text?: TextInputProps;
  area?: boolean | TextareaProps;
  select?: boolean | Partial<ControlSelectProps>;
  password?: boolean | PasswordInputProps;
  switch?: boolean | SwitchProps;
  number?: boolean | NumberInputProps;
  file?: boolean | FileInputProps;
  color?: boolean | ColorInputProps;
  date?: boolean | DateInputProps;
  datetime?: boolean | DateTimePickerProps;
  time?: boolean | TimeInputProps;
  custom?: ComponentType<CustomControlProps>;
}

/**
 * Generic form control that renders the appropriate input based on the schema and props.
 *
 * Supports:
 * - TextInput (with format detection: email, url, tel)
 * - Textarea
 * - NumberInput (for number/integer types)
 * - FileInput
 * - ColorInput (for color format)
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
 * Automatically handles labels, descriptions, error messages, required state, and default icons.
 */
const Control = (_props: ControlProps) => {
  const form = useFormState(_props.input, ["error"]);
  const { inputProps, id, icon, format, schema } = parseInput(_props, form);
  if (!_props.input?.props) {
    return null;
  }

  const props = {
    ..._props,
    ...schema.$control,
  };

  //region <Custom/>
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
  //endregion

  //region <NumberInput/>
  if (
    props.number ||
    (props.input.schema &&
      "type" in props.input.schema &&
      (props.input.schema.type === "number" ||
        props.input.schema.type === "integer"))
  ) {
    const numberInputProps =
      typeof props.number === "object" ? props.number : {};
    const { type, ...inputPropsWithoutType } = props.input.props;
    return (
      <NumberInput
        {...inputProps}
        id={id}
        leftSection={icon}
        {...inputPropsWithoutType}
        {...numberInputProps}
      />
    );
  }
  //endregion

  //region <FileInput/>
  if (props.file) {
    const fileInputProps = typeof props.file === "object" ? props.file : {};
    return (
      <FileInput
        {...inputProps}
        id={id}
        leftSection={icon}
        onChange={(file) => {
          props.input.set(file);
        }}
        {...fileInputProps}
      />
    );
  }
  //endregion

  //region <ColorInput/>
  if (props.color || format === "color") {
    const colorInputProps = typeof props.color === "object" ? props.color : {};
    return (
      <ColorInput
        {...inputProps}
        id={id}
        leftSection={icon}
        {...props.input.props}
        {...colorInputProps}
      />
    );
  }
  //endregion

  //region <ControlSelect/>
  // Handle: single enum, array of enum, array of strings, or explicit select/multi/tags props
  const isEnum =
    props.input.schema &&
    "enum" in props.input.schema &&
    props.input.schema.enum;
  const isArray =
    props.input.schema &&
    "type" in props.input.schema &&
    props.input.schema.type === "array";

  if (isEnum || isArray || props.select) {
    const opts = typeof props.select === "object" ? props.select : {};
    return (
      <ControlSelect
        input={props.input}
        title={props.title}
        description={props.description}
        icon={icon}
        {...opts}
      />
    );
  }
  //endregion

  //region <Switch/>
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
  //endregion

  //region <PasswordInput/>
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

  //region <ControlDate/>
  // Handle: date, date-time, and time formats
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
  //endregion

  //region <TextInput/> with format detection
  const textInputProps = typeof props.text === "object" ? props.text : {};

  // Detect HTML5 input type from format
  const getInputType = (): string | undefined => {
    switch (format) {
      case "email":
        return "email";
      case "url":
      case "uri":
        return "url";
      case "tel":
      case "phone":
        return "tel";
      default:
        return undefined;
    }
  };

  return (
    <TextInput
      {...inputProps}
      id={id}
      leftSection={icon}
      type={getInputType()}
      {...props.input.props}
      {...textInputProps}
    />
  );
  //endregion
};

export default Control;

export type CustomControlProps = {
  defaultValue: any;
  onChange: (value: any) => void;
};
