import {
  Input,
  NumberInput,
  type NumberInputProps,
  Slider,
  type SliderProps,
} from "@mantine/core";
import { useFieldValue, useFormState } from "alepha/react/form";
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
  const [value, setValue] = useFieldValue(props.input);
  const { inputProps, id, icon } = parseInput(props, form);

  if (!props.input?.props) {
    return null;
  }

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
            id={id}
            {...props.sliderProps}
            value={value ?? 0}
            min={min}
            max={max}
            label={() => value}
            onChange={(val) => setValue(val)}
          />
        </div>
      </Input.Wrapper>
    );
  }

  return (
    <NumberInput
      {...inputProps}
      id={id}
      leftSection={icon}
      {...props.numberInputProps}
      value={value ?? ""}
      onChange={(val) => {
        const newValue = val !== null ? Number(val) : undefined;
        setValue(newValue);
      }}
    />
  );
};

export default ControlNumber;
