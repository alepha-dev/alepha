/**
 * TypeProvider — now a thin compatibility shim over `z` (zod 4).
 *
 * typebox is gone, and so is the `t` export that fronted it — use `z`. The
 * legacy `T*` type NAMES survive as aliases of their zod equivalents so
 * existing call-sites keep compiling while they migrate to `z` / `Infer`.
 */
import { z as zod } from "zod";
import type { TFile, TStream } from "../helpers/FileLike.ts";
import {
  type Infer,
  type NumberOptions,
  type SchemaOptions,
  type StringOptions,
  type TextOptions,
  type ZObject,
  type ZType,
  z,
} from "./ZodProvider.ts";

export type { TFile, TStream };

/** Re-export the `z` provider (the canonical alepha zod) for relative imports. */
export { z };

/** Raw zod namespace (legacy `Type` escape hatch). */
export const Type = zod;

// ---------------------------------------------------------------------------
// Legacy type-name aliases (typebox -> zod)
// ---------------------------------------------------------------------------

export type Static<T extends ZType> = Infer<T>;
export type StaticDecode<T extends ZType> = Infer<T>;
export type StaticEncode<T extends ZType> = Infer<T>;

export type TSchema = ZType;
export type TObject<T extends zod.ZodRawShape = any> = ZObject<T>;
export type TProperties = zod.ZodRawShape;
export type TString = zod.ZodString;
export type TNumber = zod.ZodNumber;
export type TInteger = zod.ZodNumber;
export type TBoolean = zod.ZodBoolean;
export type TArray<T extends ZType = ZType> = zod.ZodArray<T>;
export type TUnion<_T extends ZType[] = ZType[]> = zod.ZodUnion;
export type TRecord = zod.ZodRecord<any, any>;
export type TTuple = ZType;
export type TNull = zod.ZodNull;
export type TAny = zod.ZodAny;
export type TVoid = zod.ZodVoid;
export type TBigInt = zod.ZodString;
export type TUnsafe<_T = unknown> = ZType;
export type TOptional<T extends ZType = ZType> = zod.ZodOptional<T>;
export type TOptionalAdd<T extends ZType = ZType> = zod.ZodOptional<T>;
export type TPick<T extends ZObject = ZObject, _K = unknown> = T;
export type TOmit<T extends ZObject = ZObject, _K = unknown> = T;
export type TPartial<_T extends ZObject = ZObject> = ZObject;
export type TInterface<_T = unknown, _U = unknown> = ZObject;
export type TKeysToIndexer<_T = unknown> = any;

export type TSchemaOptions = SchemaOptions;
export type TStringOptions = StringOptions;
export type TNumberOptions = NumberOptions;
export type TObjectOptions = SchemaOptions;
export type TArrayOptions = SchemaOptions;
export type TextLength = "short" | "regular" | "long" | "rich";
export type TTextOptions = TextOptions;
export interface TEnumOptions extends TextOptions {
  /** `"text"` = TEXT column; omitted = a real PostgreSQL ENUM type. */
  mode?: "text";
  /** Custom PG ENUM type name (shared across tables). */
  name?: string;
}

/** Legacy `TypeProvider` — kept for its static config knobs. */
export class TypeProvider {
  static DEFAULT_STRING_MAX_LENGTH: number | undefined = 255;
  static DEFAULT_SHORT_STRING_MAX_LENGTH: number | undefined = 64;
  static DEFAULT_LONG_STRING_MAX_LENGTH: number | undefined = 1024;
  static DEFAULT_RICH_STRING_MAX_LENGTH: number | undefined = 65535;
  static DEFAULT_ARRAY_MAX_ITEMS = 1000;
  static translateError = (error: { message?: string }, _locale?: string) =>
    error.message ?? "";
  static setLocale = (_locale: string) => {};
  static isValidBigInt = (value: string | number) =>
    typeof value === "number"
      ? Number.isInteger(value)
      : /^-?\d+$/.test(value.trim());
}
