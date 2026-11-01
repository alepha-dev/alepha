/**
 * `z` is a namespace, not an object, so a bundler keeps only the members an
 * application calls.
 */
export * as z from "./zodNamespace.ts";
export { Z_LIMITS } from "./zodNamespace.ts";
export type {
  Infer,
  NumberOptions,
  SchemaOptions,
  SchemaOutput,
  StringOptions,
  TextOptions,
  ZObject,
  ZodAny,
  ZodArray,
  ZodBoolean,
  ZodNull,
  ZodNumber,
  ZodOptional,
  ZodRawShape,
  ZodRecord,
  ZodString,
  ZodUnion,
  ZodVoid,
  ZType,
} from "./zodNamespace.ts";

export type Z = typeof import("./zodNamespace.ts");
