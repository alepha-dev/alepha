import {
  Input,
  NumberInput,
  type NumberInputProps,
  Slider,
  type SliderProps,
} from "@mantine/core";
import { useEvents } from "alepha/react";
import { useFormState } from "alepha/react/form";
import { useRef, useState } from "react";
import { type GenericControlProps, parseInput } from "../utils/parseInput.ts";

export interface ControlNumberProps extends GenericControlProps {
  numberInputProps?: Partial<NumberInputProps>;
  sliderProps?: Partial<SliderProps>;
}

/**
 *
 */
const ControlNumber = (props: ControlNumberProps) => {
  const form = useFormState(props.input);
  const { inputProps, id, icon } = parseInput(props, form);
  const ref = useRef<HTMLInputElement | null>(null);

  // HTML Reset doesn't trigger on <NumberInput /> so we handle it manually

  const [value, setValue] = useState<number | undefined>(
    props.input.props.defaultValue,
  );

  useEvents(
    {
      "form:reset": (event) => {
        if (event.id === props.input?.form.id && ref.current) {
          setValue(props.input.props.defaultValue);
        }
      },
    },
    [props.input],
  );

  if (!props.input?.props) {
    return null;
  }

  const { type, ...inputPropsWithoutType } = props.input.props;

  if (props.sliderProps) {
    const min = props.sliderProps.min ?? inputProps.minimum ?? 0;
    const max = props.sliderProps.max ?? inputProps.maximum ?? 100;
    return (
      <Input.Wrapper {...inputProps}>
        <div
          style={{
            height: 32,
            padding: 8,
          }}
        >
          <Slider
            {...inputProps}
            ref={ref}
            id={id}
            {...inputPropsWithoutType}
            {...props.sliderProps}
            value={value}
            min={min}
            max={max}
            label={() => value}
            onChange={(val) => {
              setValue(val);
              props.input.set(val);
            }}
          />
        </div>
      </Input.Wrapper>
    );
  }

  return (
    <NumberInput
      {...inputProps}
      ref={ref}
      id={id}
      leftSection={icon}
      {...inputPropsWithoutType}
      {...props.numberInputProps}
      value={value ?? ""}
      onChange={(val) => {
        const newValue = val !== null ? Number(val) : undefined;
        setValue(newValue);
        props.input.set(newValue);
      }}
    />
  );
};

export default ControlNumber;
