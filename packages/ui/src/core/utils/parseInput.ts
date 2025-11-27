import type { InputField } from "@alepha/react/form";
import { type TObject, TypeBoxError } from "alepha";
import {
  createElement,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";
import type { ControlProps } from "../components/form/Control.tsx";
import { ui } from "../constants/ui.ts";
import { getDefaultIcon } from "./icons.tsx";
import { prettyName } from "./string.ts";

export const parseInput = (
  props: GenericControlProps,
  form: {
    error?: Error;
  },
): ControlInput => {
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

  // Auto-generate icon if not provided
  const icon = !props.icon
    ? getDefaultIcon({
        type:
          props.input.schema && "type" in props.input.schema
            ? String(props.input.schema.type)
            : undefined,
        format:
          props.input.schema &&
          "format" in props.input.schema &&
          typeof props.input.schema.format === "string"
            ? props.input.schema.format
            : undefined,
        name: props.input.props.name,
        isEnum:
          props.input.schema &&
          "enum" in props.input.schema &&
          Boolean(props.input.schema.enum),
        isArray:
          props.input.schema &&
          "type" in props.input.schema &&
          props.input.schema.type === "array",
      })
    : isValidElement(props.icon)
      ? props.icon
      : createElement(props.icon, { size: ui.sizes.icon.md });

  const format =
    props.input.schema &&
    "format" in props.input.schema &&
    typeof props.input.schema.format === "string"
      ? props.input.schema.format
      : undefined;

  const required = props.input.required;
  const schema = props.input.schema as TObject & { $control?: ControlProps };

  const inputProps: InputProps = {
    label,
    description,
    error,
    required,
    disabled,
  };

  if ("minLength" in schema && typeof schema.minLength === "number") {
    inputProps.minLength = schema.minLength;
  }
  if ("maxLength" in schema && typeof schema.maxLength === "number") {
    inputProps.maxLength = schema.maxLength;
  }
  if ("minimum" in schema && typeof schema.minimum === "number") {
    inputProps.minimum = schema.minimum;
  }
  if ("maximum" in schema && typeof schema.maximum === "number") {
    inputProps.maximum = schema.maximum;
  }

  return {
    id,
    icon,
    format,
    schema: props.input.schema as TObject & { $control?: ControlProps },
    inputProps,
  };
};

export interface GenericControlProps {
  input: InputField;
  title?: string;
  description?: string;
  icon?: ReactElement | ((props: { size: number }) => ReactNode);
}

export interface ControlInput {
  id?: string;
  icon: ReactElement;
  format?: string;
  schema: TObject & { $control?: ControlProps };
  inputProps: InputProps;
}

export interface InputProps {
  label: string;
  description?: string;
  error?: string;
  required: boolean;
  disabled: boolean;

  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
}
