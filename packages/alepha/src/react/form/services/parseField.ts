import { type TSchema, TypeBoxError } from "alepha";
import type { BaseInputField } from "./FormModel.ts";
import { prettyName } from "./prettyName.ts";

/**
 * Semantic icon hint derived from schema metadata. UI layers map this
 * to their own icon set — this module is headless and ships no JSX.
 */
export type IconHint =
  | "email"
  | "password"
  | "phone"
  | "url"
  | "number"
  | "calendar"
  | "clock"
  | "list"
  | "text"
  | "user"
  | "file"
  | "switch";

export interface FieldConstraints {
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  pattern?: string;
}

export interface FieldMeta {
  id?: string;
  label: string;
  description?: string;
  error?: string;
  required: boolean;
  type?: string;
  format?: string;
  isEnum: boolean;
  isArray: boolean;
  isObject: boolean;
  isArrayOfObjects: boolean;
  enum?: readonly unknown[];
  iconHint?: IconHint;
  constraints: FieldConstraints;
  testId?: string;
  schema: TSchema;
  /**
   * Raw `$control` value from the schema, untyped here. The UI layer
   * (`alepha/react/ui`) provides the strict {@link SchemaControl} type and
   * a `resolveSchemaControl` helper to evaluate the function form.
   */
  control?: unknown;
}

export interface ParseFieldOptions {
  label?: string;
  description?: string;
  error?: Error;
}

/**
 * Derives a {@link FieldMeta} from an `InputField` (from `useForm`) plus
 * optional overrides. Pure — no React, no JSX, no UI library coupling.
 *
 * UI components consume this metadata to render labels, descriptions,
 * error messages, icons, and validation constraints.
 */
export const parseField = (
  input: BaseInputField,
  options: ParseFieldOptions = {},
): FieldMeta => {
  const schema = input.schema as TSchema & {
    type?: string;
    format?: string;
    title?: string;
    description?: string;
    enum?: readonly unknown[];
    minLength?: number;
    maxLength?: number;
    minimum?: number;
    maximum?: number;
    pattern?: string;
    properties?: unknown;
    items?: { properties?: unknown };
    $control?: unknown;
  };

  const label =
    options.label ??
    (typeof schema.title === "string" ? schema.title : undefined) ??
    prettyName(input.path);

  const description =
    options.description ??
    (typeof schema.description === "string" ? schema.description : undefined);

  const error =
    options.error instanceof TypeBoxError
      ? (options.error as TypeBoxError).value?.message
      : undefined;

  const type = schema.type;
  const format = typeof schema.format === "string" ? schema.format : undefined;
  const isEnum = Array.isArray(schema.enum);
  const isArray = type === "array";
  const isObject = type === "object" && Boolean(schema.properties);
  const isArrayOfObjects =
    isArray && Boolean(schema.items && (schema.items as any).properties);

  const name = input.props.name;
  const iconHint = inferIconHint({ type, format, name, isEnum, isArray });

  const constraints: FieldConstraints = {};
  if (typeof schema.minLength === "number")
    constraints.minLength = schema.minLength;
  if (typeof schema.maxLength === "number")
    constraints.maxLength = schema.maxLength;
  if (typeof schema.minimum === "number") constraints.minimum = schema.minimum;
  if (typeof schema.maximum === "number") constraints.maximum = schema.maximum;
  if (typeof schema.pattern === "string") constraints.pattern = schema.pattern;

  return {
    id: input.props.id,
    label,
    description,
    error,
    required: input.required,
    type,
    format,
    isEnum,
    isArray,
    isObject,
    isArrayOfObjects,
    enum: schema.enum,
    iconHint,
    constraints,
    testId: (input.props as Record<string, unknown>)["data-testid"] as
      | string
      | undefined,
    schema: input.schema,
    control: schema.$control,
  };
};

const inferIconHint = (params: {
  type?: string;
  format?: string;
  name?: string;
  isEnum: boolean;
  isArray: boolean;
}): IconHint | undefined => {
  const { type, format, name, isEnum, isArray } = params;

  if (format === "email") return "email";
  if (format === "url" || format === "uri") return "url";
  if (format === "tel" || format === "phone") return "phone";
  if (format === "date" || format === "date-time") return "calendar";
  if (format === "time") return "clock";

  if (name?.toLowerCase().includes("password")) return "password";
  if (name?.toLowerCase().includes("email")) return "email";
  if (name?.toLowerCase().includes("phone")) return "phone";

  if (type === "boolean") return "switch";
  if (type === "number" || type === "integer") return "number";
  if (isEnum || isArray) return "list";
  if (type === "string") return "text";

  return undefined;
};
