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
 * localization (`translateError` / `setLocale`). The string length caps live
 * in `Z_LIMITS` (ZodProvider) now.
 */
export class TypeProvider {
  static translateError = (error: { message?: string }, _locale?: string) =>
    error.message ?? "";
  static setLocale = (_locale: string) => {};
}
