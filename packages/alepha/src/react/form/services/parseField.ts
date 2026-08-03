import { SchemaValidationError, type ZType, z } from "alepha";
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
  schema: ZType;
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
  // Peel optional/nullable/default wrappers: structure, `.meta()`, format and
  // constraints all live on the inner schema, not the wrapper. `required` is
  // tracked separately via `input.required`.
  const schema = z.schema.unwrap(input.schema) as ZType & {
    minLength?: number;
    maxLength?: number;
    minValue?: number;
    maxValue?: number;
  };

  // Title / description / `$control` ride on zod's `.meta()` registry now
  // (typebox kept them as plain schema properties). Read them from there.
  const meta = (
    typeof (schema as any).meta === "function" ? (schema as any).meta() : null
  ) as Record<string, unknown> | null;

  const label =
    options.label ??
    (typeof meta?.title === "string" ? meta.title : undefined) ??
    prettyName(input.path);

  const description =
    options.description ??
    (typeof meta?.description === "string" ? meta.description : undefined);

  const error =
    options.error instanceof SchemaValidationError
      ? (options.error as SchemaValidationError).value?.message
      : undefined;

  // Structural classification via zod guards (the schema is a real zod schema,
  // not a JSON-Schema object — `schema.type`/`schema.enum` no longer apply).
  const isEnum = z.schema.isEnum(schema);
  const isArray = z.schema.isArray(schema);
  const isObject = z.schema.isObject(schema);
  const isInteger = z.schema.isInteger(schema);
  const isNumber = !isInteger && z.schema.isNumber(schema);
  const isBoolean = z.schema.isBoolean(schema);
  const type = isObject
    ? "object"
    : isArray
      ? "array"
      : isEnum
        ? "string"
        : isInteger
          ? "integer"
          : isNumber
            ? "number"
            : isBoolean
              ? "boolean"
              : z.schema.isString(schema)
                ? "string"
                : undefined;

  const format =
    typeof z.schema.format(schema) === "string"
      ? z.schema.format(schema)
      : undefined;
  const element = z.schema.element(schema) ?? z.schema.items(schema)[0];
  // An array of a UNION of objects is still an array of objects for editing
  // purposes — `z.array(z.union([...]))` is how a heterogeneous list (a
  // discriminated one, most often) is spelled, and classifying it as scalars
  // sends it to the tag-list control, which stringifies each item to
  // "[object Object]". ControlArray resolves the variant per item.
  const isArrayOfObjects = isArray && isObjectOrUnionOfObjects(element);

  const name = input.props.name;
  const iconHint = inferIconHint({ type, format, name, isEnum, isArray });

  const constraints: FieldConstraints = {};
  if (typeof schema.minLength === "number")
    constraints.minLength = schema.minLength;
  if (typeof schema.maxLength === "number")
    constraints.maxLength = schema.maxLength;
  if (typeof schema.minValue === "number")
    constraints.minimum = schema.minValue;
  if (typeof schema.maxValue === "number")
    constraints.maximum = schema.maxValue;
  const pattern = readPattern(schema);
  if (pattern) constraints.pattern = pattern;

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
    enum: isEnum ? z.schema.enumValues(schema) : undefined,
    iconHint,
    constraints,
    testId: (input.props as Record<string, unknown>)["data-testid"] as
      | string
      | undefined,
    schema: input.schema,
    control: meta?.$control,
  };
};

/** Best-effort read of a `ZodString` regex pattern from its check list. */
const readPattern = (schema: unknown): string | undefined => {
  const checks = (schema as any)?._zod?.def?.checks as
    | Array<{ _zod?: { def?: { pattern?: RegExp; format?: string } } }>
    | undefined;
  if (!Array.isArray(checks)) return undefined;
  for (const check of checks) {
    const pattern = check?._zod?.def?.pattern;
    if (pattern instanceof RegExp) return pattern.source;
  }
  return undefined;
};

/**
 * Variants of a union schema, or `undefined` when `schema` is not one.
 * `anyOf` is the JSON-Schema spelling (a round-tripped schema), `options`
 * zod's own — both appear in practice.
 */
export const unionVariants = (schema: unknown): ZType[] | undefined => {
  if (!schema || !z.schema.isUnion(schema as ZType)) {
    return undefined;
  }
  const variants = z.schema.options(schema as ZType);
  return variants.length > 0 ? variants : undefined;
};

/**
 * True for an object schema, and for a union whose every variant is an object
 * (a discriminated union of objects) — both are editable as objects.
 */
export const isObjectOrUnionOfObjects = (schema: unknown): boolean => {
  if (!schema) return false;
  if (z.schema.isObject(schema as ZType)) return true;
  const variants = unionVariants(schema);
  return (
    !!variants &&
    variants.length > 0 &&
    variants.every((variant) => z.schema.isObject(z.schema.unwrap(variant)))
  );
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
