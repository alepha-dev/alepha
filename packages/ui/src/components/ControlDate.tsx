import { useFormState } from "@alepha/react-form";
import {
  DateInput,
  type DateInputProps,
  DateTimePicker,
  type DateTimePickerProps,
  TimeInput,
  type TimeInputProps,
} from "@mantine/dates";
import { type GenericControlProps, parseInput } from "../utils/parseInput.ts";

export interface ControlDateProps extends GenericControlProps {
  date?: boolean | DateInputProps;
  datetime?: boolean | DateTimePickerProps;
  time?: boolean | TimeInputProps;
}

/**
 * ControlDate component for handling date, datetime, and time inputs.
 *
 * Features:
 * - DateInput for date format
 * - DateTimePicker for date-time format
 * - TimeInput for time format
 *
 * Automatically detects date formats from schema and renders appropriate picker.
 */
const ControlDate = (props: ControlDateProps) => {
  const form = useFormState(props.input);
  const { inputProps, id, icon, format } = parseInput(props, form);
  if (!props.input?.props) {
    return null;
  }

  // region <DateTimePicker/>
  if (props.datetime || format === "date-time") {
    const dateTimePickerProps =
      typeof props.datetime === "object" ? props.datetime : {};
    return (
      <DateTimePicker
        {...inputProps}
        id={id}
        leftSection={icon}
        defaultValue={
          props.input.props.defaultValue
            ? new Date(props.input.props.defaultValue)
            : undefined
        }
        onChange={(value) => {
          props.input.set(value ? new Date(value).toISOString() : undefined);
        }}
        {...dateTimePickerProps}
      />
    );
  }
  //endregion

  // region <DateInput/>
  if (props.date || format === "date") {
    const dateInputProps = typeof props.date === "object" ? props.date : {};
    return (
      <DateInput
        {...inputProps}
        id={id}
        leftSection={icon}
        defaultValue={
          props.input.props.defaultValue
            ? new Date(props.input.props.defaultValue)
            : undefined
        }
        onChange={(value) => {
          props.input.set(
            value ? new Date(value).toISOString().slice(0, 10) : undefined,
          );
        }}
        {...dateInputProps}
      />
    );
  }
  //endregion

  // region <TimeInput/>
  if (props.time || format === "time") {
    const timeInputProps = typeof props.time === "object" ? props.time : {};
    return (
      <TimeInput
        {...inputProps}
        id={id}
        leftSection={icon}
        defaultValue={props.input.props.defaultValue}
        onChange={(event) => {
          props.input.set(event.currentTarget.value);
        }}
        {...timeInputProps}
      />
    );
  }
  //endregion

  // Fallback - shouldn't happen
  return null;
};

export default ControlDate;
