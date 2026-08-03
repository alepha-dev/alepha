/**
 * Schema type surface — a re-export point over `z` (zod 4).
 *
 * typebox is gone: so is the `t` builder that fronted it, and so are the `T*`
 * type names that shadowed zod's own. Use `z` for schemas, and
 * {@link Infer} / {@link ZType} / {@link ZObject} plus zod's own `Zod*` names
 * for the type level — all re-exported from `ZodProvider`.
 */
import type { FileSchema, StreamSchema } from "../helpers/FileLike.ts";
import { z } from "./ZodProvider.ts";

export type { FileSchema, StreamSchema };

/** Re-export the `z` provider (the canonical alepha zod) for relative imports. */
export { z };

/**
 * Static config knobs, still read by `I18nProvider` for validation-error
 * localization.
 */
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
