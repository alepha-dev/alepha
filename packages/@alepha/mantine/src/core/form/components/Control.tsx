import {
  ColorInput,
  type ColorInputProps,
  FileInput,
  type FileInputProps,
  Flex,
  Input,
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
import { useFieldValue, useFormState } from "alepha/react/form";
import type { ComponentType } from "react";
import { type GenericControlProps, parseInput } from "../utils/parseInput.ts";
import ControlArray, { type ControlArrayProps } from "./ControlArray.tsx";
import ControlDate from "./ControlDate.tsx";
import ControlNumber, { type ControlNumberProps } from "./ControlNumber.tsx";
import ControlObject, { type ControlObjectProps } from "./ControlObject.tsx";
import ControlSelect, { type ControlSelectProps } from "./ControlSelect.tsx";

export interface ControlProps extends GenericControlProps {
  text?: TextInputProps;
  area?: boolean | TextareaProps;
  select?: boolean | Partial<ControlSelectProps>;
  password?: boolean | PasswordInputProps;
  switch?: boolean | SwitchProps;
  number?: boolean | Partial<ControlNumberProps>;
  file?: boolean | FileInputProps;
  color?: boolean | ColorInputProps;
  date?: boolean | DateInputProps;
  datetime?: boolean | DateTimePickerProps;
  time?: boolean | TimeInputProps;
  object?: boolean | Partial<Omit<ControlObjectProps, "input">>; // Nested object editing
  array?: boolean | Partial<Omit<ControlArrayProps, "input">>; // Array of items editing
  custom?: ComponentType<CustomControlProps>;

  slider?: boolean;
  segmented?: boolean;
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
 * - ControlObject (for nested object schemas)
 * - ControlArray (for arrays of objects)
 * - Custom component
 *
 * Automatically handles labels, descriptions, error messages, required state, and default icons.
 */
const Control = (_props: ControlProps) => {
  const form = useFormState(_props.input, ["error"]);
  const [value, setValue] = useFieldValue(_props.input);

  // Early return if input is not properly initialized
  if (!_props.input?.props) {
    return null;
  }

  const { inputProps, id, icon, format, schema } = parseInput(_props, form);

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
            value={value}
            onChange={(val) => {
              setValue(val);
            }}
          />
        </Flex>
      </Input.Wrapper>
    );
  }
  //endregion

  //region <ControlObject/>
  // Handle nested objects with properties
  const isObject =
    props.input.schema &&
    "type" in props.input.schema &&
    props.input.schema.type === "object" &&
    "properties" in props.input.schema;

  if (props.object || isObject) {
    const controlObjectProps =
      typeof props.object === "object" ? props.object : {};
    return (
      <ControlObject
        input={props.input}
        label={props.label}
        description={props.description}
        {...controlObjectProps}
      />
    );
  }
  //endregion

  //region <ControlArray/>
  // Handle arrays of objects (arrays of primitives are handled by ControlSelect)
  const isArray =
    props.input.schema &&
    "type" in props.input.schema &&
    props.input.schema.type === "array";

  const isArrayOfObjects =
    isArray &&
    "items" in props.input.schema &&
    props.input.schema.items &&
    typeof props.input.schema.items === "object" &&
    "properties" in props.input.schema.items;

  if (props.array || isArrayOfObjects) {
    const controlArrayProps =
      typeof props.array === "object" ? props.array : {};
    return (
      <ControlArray
        input={props.input}
        label={props.label}
        description={props.description}
        {...controlArrayProps}
      />
    );
  }
  //endregion

  //region <NumberInput/>
  if (
    props.number ||
    (!props.select &&
      props.input.schema &&
      "type" in props.input.schema &&
      (props.input.schema.type === "number" ||
        props.input.schema.type === "integer"))
  ) {
    const controlNumberProps =
      typeof props.number === "object" ? props.number : {};
    if (props.slider) {
      controlNumberProps.sliderProps ??= {};
    }
    return (
      <ControlNumber
        size={props.size}
        input={props.input}
        label={props.label}
        description={props.description}
        icon={icon}
        {...controlNumberProps}
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
        size={props.size}
        id={id}
        leftSection={icon}
        onChange={(file) => setValue(file)}
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
        size={props.size}
        id={id}
        leftSection={icon}
        value={value ?? ""}
        onChange={(val) => setValue(val)}
        {...colorInputProps}
      />
    );
  }
  //endregion

  //region <ControlSelect/>
  // Handle: single enum, array of enum, array of strings, or explicit select/multi/tags props
  // Note: arrays of objects are handled by ControlArray above, this handles primitive arrays
  const isEnum =
    props.input.schema &&
    "enum" in props.input.schema &&
    props.input.schema.enum;

  if (isEnum || (isArray && !isArrayOfObjects) || props.select) {
    const opts = typeof props.select === "object" ? props.select : {};
    if (props.segmented) {
      opts.segmentedProps ??= {};
    }
    return (
      <ControlSelect
        size={props.size}
        input={props.input}
        label={props.label}
        description={props.description}
        icon={icon}
        {...opts}
      />
    );
  }
  //endregion

  //region <Switch/>
  if (
    props.input.schema &&
    "type" in props.input.schema &&
    props.input.schema.type === "boolean"
  ) {
    if (props.switch) {
      const switchProps = typeof props.switch === "object" ? props.switch : {};
      return (
        <Switch
          {...inputProps}
          size={props.size}
          id={id}
          color={"blue"}
          checked={Boolean(value)}
          onChange={(event) => {
            setValue(event.currentTarget.checked);
          }}
          {...switchProps}
        />
      );
    }

    const opts: ControlSelectProps = {
      input: props.input,
      selectProps: {
        data: [
          { value: "true", label: "Yes" },
          { value: "false", label: "No" },
        ],
      },
    };

    return (
      <ControlSelect
        size={props.size}
        label={props.label}
        description={props.description}
        icon={icon}
        {...opts}
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
        size={props.size}
        id={id}
        leftSection={icon}
        value={value ?? ""}
        onChange={(ev) => setValue(ev.target.value)}
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
        size={props.size}
        id={id}
        leftSection={icon}
        value={value ?? ""}
        onChange={(ev) => setValue(ev.target.value)}
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
        size={props.size}
        input={props.input}
        label={props.label}
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
        return props.input.props.type ?? "text";
    }
  };

  return (
    <TextInput
      {...inputProps}
      size={props.size}
      id={id}
      leftSection={icon}
      type={getInputType()}
      value={value ?? ""}
      onChange={(ev) => setValue(ev.target.value)}
      {...textInputProps}
    />
  );
  //endregion
};

export default Control;

export type CustomControlProps = {
  value: any;
  onChange: (value: any) => void;
};
