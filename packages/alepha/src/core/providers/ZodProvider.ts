import { z as zod } from "zod";
import enLocale from "zod/v4/locales/en.js";
import "./zodAugment.ts";

// Re-activate zod's English error map. zod's classic entry does this as a module
// side effect (`config(en())`) so messages read "Too small: expected string to
// have >=2 characters" instead of a bare "Invalid input". That side effect is
// tree-shaken away under bundlers (zod is `sideEffects: false`) once nothing
// pins the whole zod namespace, so we call it explicitly from alepha (which is
// not `sideEffects: false`, so the call survives). Bundles only `en` (~1 KB gz).
zod.config(enLocale());

/**
 * Alepha's `z` — a thin, enhanceable wrapper over zod 4 that mirrors the
 * ergonomics of the legacy typebox `t` provider (same call-shapes, so existing
 * `t.*` call-sites become a near-mechanical rename), while delegating all
 * validation + static-type inference to zod.
 *
 * Design notes:
 * - No encode/decode. string -> string, number -> number. Validation is a plain
 *   `schema.parse(value)` — zod does NOT use `Function`/`eval`, so this is safe
 *   inside Cloudflare Workers (unlike typebox's `Compile`).
 * - Metadata (`title`, `description`, `format`, custom `~options`) rides on zod's
 *   native `.meta()` registry, so `z.toJSONSchema()` round-trips it for OpenAPI
 *   + form generation. Defaults use `.default()`.
 */

// ---------------------------------------------------------------------------
// Re-exported type aliases (the spine swap: Static->Infer, TObject->ZObject…)
// ---------------------------------------------------------------------------

export type ZType = zod.ZodType;
export type ZObject<T extends zod.ZodRawShape = any> = zod.ZodObject<T>;
/** Replaces typebox `Static<T>`. */
export type Infer<T extends zod.ZodType> = zod.infer<T>;

/**
 * Shallow output-extraction for `T extends SomeSchema ? Static<T> : Fallback`
 * conditional positions.
 *
 * Reads zod's `_zod.output` directly (a single shallow conditional) instead of
 * first testing `T extends TRequestBody` / `TResponseBody` — those tests compare
 * `T` against 5-6 member unions of deeply-recursive zod class types, and that
 * structural assignability check is what trips TypeScript's instantiation-depth
 * limit (TS2589) inside `$action`'s generics. The extracted type is identical to
 * `Static<T>` for any real schema; non-schema `T` (e.g. `undefined`) yields
 * `Fallback`.
 */
export type SchemaOutput<T, Fallback = any> = [T] extends [
  { _zod: { output: infer O } },
]
  ? O
  : Fallback;

export interface SchemaOptions {
  title?: string;
  description?: string;
  default?: unknown;
  format?: string;
  /** Alepha string transforms, kept for JSON-Schema round-trip parity. */
  "~options"?: { trim?: boolean; lowercase?: boolean };
  [key: string]: unknown;
}

export interface StringOptions extends SchemaOptions {
  minLength?: number;
  maxLength?: number;
  pattern?: string | RegExp;
}

export interface NumberOptions extends SchemaOptions {
  minimum?: number;
  maximum?: number;
}

export interface TextOptions extends StringOptions {
  size?: "short" | "regular" | "long" | "rich";
  trim?: boolean;
  lowercase?: boolean;
}

// ---------------------------------------------------------------------------

/** Defaults mirroring TypeProvider's static length caps. */
export const Z_LIMITS = {
  short: 64,
  regular: 255,
  long: 1024,
  rich: 65535,
  arrayMaxItems: 1000,
};

/** Attach metadata + default without changing the schema's inferred type. */
const meta = <T extends zod.ZodType>(schema: T, options?: SchemaOptions): T => {
  if (!options) return schema;
  const { default: def, ...rest } = options;
  let s: zod.ZodType = schema;
  if (def !== undefined) s = s.default(def as never);
  if (Object.keys(rest).length > 0) s = s.meta(rest as Record<string, unknown>);
  return s as T;
};

const applyString = (base: zod.ZodString, o?: StringOptions): zod.ZodString => {
  let s = base;
  if (o?.minLength != null) s = s.min(o.minLength);
  if (o?.maxLength != null) s = s.max(o.maxLength);
  if (o?.pattern)
    s = s.regex(
      typeof o.pattern === "string" ? new RegExp(o.pattern) : o.pattern,
    );
  return s;
};

/** zod's native `.format` getter (uuid/email/safeint/…), guarded. */
const nativeFmt = (s: any): string | undefined => {
  try {
    return (s?.format ?? undefined) as string | undefined;
  } catch {
    return undefined;
  }
};

/**
 * Read the JSON-Schema-style format tag off a schema (drives ORM columns).
 * Prefers our normalized `.meta({ format })` (typebox vocab: `date-time`,
 * `int64`, `binary`, …) and falls back to zod's native `.format`.
 */
const fmt = (s: any): string | undefined => {
  try {
    return (s?.meta?.()?.format ?? nativeFmt(s)) as string | undefined;
  } catch {
    return undefined;
  }
};

/** zod's internal type discriminator (`string` | `number` | …), wrapping-safe. */
const defType = (s: any): string | undefined => s?._zod?.def?.type;

/** Tag a string-format schema with its JSON-Schema `format` (stays a real `ZodString`). */
const strFmt = (base: zod.ZodType, format: string): zod.ZodString =>
  meta(base, { format }) as unknown as zod.ZodString;

// ---------------------------------------------------------------------------
// The `z` provider — mirrors `t`'s surface.
// ---------------------------------------------------------------------------

export const z = {
  /**
   * Native zod coercion namespace (`z.coerce.number()`, `z.coerce.boolean()`…).
   * Used at the HTTP/string boundary (query, headers, env) where everything
   * arrives as a string; request bodies and the ORM stay strict (no coercion).
   */
  coerce: zod.coerce,

  // -- native builders (direct zod references — `z.object` IS `zod.object`) -
  // No alepha wrapper: schemas are configured by chaining native zod methods
  // (`.min()`, `.max()`, `.describe()`, `.meta()`, `.default()`, `.optional()`).
  object: zod.object,
  array: zod.array,
  record: zod.record,
  tuple: zod.tuple,
  union: zod.union,
  string: zod.string,
  number: zod.number,
  boolean: zod.boolean,
  null: zod.null,
  any: zod.any,
  void: zod.void,
  undefined: zod.undefined,
  literal: zod.literal,
  /** Alias for `zod.literal` (legacy `t.const`). */
  const: zod.literal,
  enum: zod.enum,
  /** Integer — native `z.int()` (format `safeint`, drives PG INT column). */
  integer: zod.int,
  /** Free-form JSON object (`Record<string, any>`). */
  json: () => zod.record(zod.string(), zod.any()),

  // -- text family (alepha size-capped strings — the options ARE the API) --
  text: (options: TextOptions = {}) => {
    const {
      size = "regular",
      trim = true,
      lowercase = false,
      maxLength,
      ...rest
    } = options;
    // An explicit `maxLength` overrides the size-based default cap (otherwise
    // both `.max()` calls stack and zod keeps the smaller — silently capping
    // a `maxLength: 1_000_000` field at 255).
    const max = maxLength ?? Z_LIMITS[size] ?? Z_LIMITS.regular;
    let s = zod.string().max(max);
    if (trim) s = s.trim();
    if (lowercase) s = s.toLowerCase();
    return meta(applyString(s, rest), {
      ...rest,
      maxLength: max,
      "~options": { trim, lowercase },
    });
  },

  shortText: (options: TextOptions = {}) =>
    z.text({ ...options, size: "short" }),
  longText: (options: TextOptions = {}) => z.text({ ...options, size: "long" }),
  richText: (options: TextOptions = {}) => z.text({ ...options, size: "rich" }),

  // -- string formats (format tag drives ORM column-type detection) --------
  // All return a real `ZodString` (assignable to `TString`, instanceof-safe);
  // the JSON-Schema format rides on `.meta()` and is read via `z.schema.format`.
  email: () => strFmt(zod.email(), "email"),
  // `z.guid` accepts any 8-4-4-4-12 hex UUID; `z.uuid` additionally enforces an
  // RFC version nibble (1-8). A generic UUID column stores arbitrary UUIDs (only
  // generated PKs are v7), so the lenient GUID validator is the correct choice.
  uuid: () => strFmt(zod.guid(), "uuid"),
  url: () => strFmt(zod.url(), "url"),
  datetime: () => strFmt(zod.iso.datetime(), "date-time"),
  /**
   * A calendar day (`YYYY-MM-DD`), not an instant.
   *
   * **Round-trip is asymmetric and the asymmetry matters.** SQLite stores
   * the column as epoch-milliseconds, but the ORM hydrates it back as a
   * date-only *string* — never a `Date`. So a value read from the
   * database is `"2026-01-01"`, and `new Date("2026-01-01")` parses it as
   * **UTC** midnight.
   *
   * That is a trap for any consumer that then reads it with local
   * getters (`getMonth()`, `getFullYear()`): west of UTC the instant
   * belongs to the previous day, and month-bucketing silently shifts by
   * one. Derive calendar fields from the string, or build a local `Date`
   * from its parts — do not mix the two.
   */
  date: () => strFmt(zod.iso.date(), "date"),
  time: () => strFmt(zod.iso.time(), "time"),
  /** bigint as a validated string (no codec). */
  bigint: () => strFmt(zod.string().regex(/^-?\d+$/), "bigint"),
  binary: () => strFmt(zod.string(), "binary"),
  duration: () => strFmt(zod.string(), "duration"),
  e164: () => z.text({ pattern: "^\\+[1-9]\\d{1,14}$" }),
  bcp47: () => z.text({ pattern: "^[a-z]{2,3}(?:-[A-Z]{2})?$" }),
  constantCase: () => z.text({ pattern: "^[A-Z_-]+$" }),

  // -- numeric variants ----------------------------------------------------
  int32: () => zod.int().min(-2147483648).max(2147483647),
  int64: () =>
    zod
      .int()
      .min(-9007199254740991)
      .max(9007199254740991)
      .meta({ format: "int64" }),

  // -- file-like / composite -----------------------------------------------
  file: (options?: { maxSize?: number }) =>
    zod.any().meta({ format: "binary", ...options }),
  stream: () => zod.any().meta({ format: "stream" }),
  valueLabel: () =>
    zod.object({
      value: z.constantCase(),
      label: z.text(),
      description: z.longText().optional(),
    }),
  /** Pagination wrapper, mirrors `pageSchema(item)`. */
  page: <T extends zod.ZodType>(item: T) =>
    zod.object({
      content: zod.array(item),
      page: zod.object({
        number: zod.int(),
        size: zod.int(),
        offset: zod.int(),
        numberOfElements: zod.int(),
        totalElements: zod.int().optional(),
        totalPages: zod.int().optional(),
        isEmpty: zod.boolean(),
        isFirst: zod.boolean(),
        isLast: zod.boolean(),
      }),
    }),

  // NOTE: modifiers (optional / nullable), structural transforms
  // (pick / omit / partial / extend) and validation (parse / safeParse) are
  // NOT provided here — call the native zod methods directly on the schema
  // (`schema.optional()`, `schema.pick({ a: true })`, `schema.parse(v)`, …).

  /** Export a schema to JSON Schema (OpenAPI / form generation). */
  toJSONSchema: zod.toJSONSchema,

  /** Runtime type guards (`z.schema.*`) — schema introspection for ORM + forms. */
  schema: {
    isOptional: (s: any) => s instanceof zod.ZodOptional,
    isDefault: (s: any) => s instanceof zod.ZodDefault,
    isObject: (s: any) => s instanceof zod.ZodObject,
    isString: (s: any) => defType(s) === "string",
    isNumber: (s: any) => defType(s) === "number",
    isBoolean: (s: any) => s instanceof zod.ZodBoolean,
    isArray: (s: any) => s instanceof zod.ZodArray,
    isUnion: (s: any) => s instanceof zod.ZodUnion,
    isNull: (s: any) => s instanceof zod.ZodNull,
    isRecord: (s: any) => s instanceof zod.ZodRecord,
    // Explicit `: boolean` (not an inferred type-predicate): the `s is ZodEnum`
    // / `s is ZodLiteral` predicates leak zod's non-exported `EnumValue` /
    // `Literal` internals into consumers' generated `.d.ts` (TS2883). No
    // call-site relies on narrowing these — they read via `enumValues`/`.value`.
    isEnum: (s: any): boolean => s instanceof zod.ZodEnum,
    isLiteral: (s: any): boolean => s instanceof zod.ZodLiteral,
    isAny: (s: any) => s instanceof zod.ZodAny,
    isNullable: (s: any) => s instanceof zod.ZodNullable,
    isInteger: (s: any) =>
      defType(s) === "number" && nativeFmt(s) === "safeint",
    isText: (s: any) => defType(s) === "string" && !fmt(s),
    isDateTime: (s: any) => fmt(s) === "date-time",
    isDate: (s: any) => fmt(s) === "date",
    isTime: (s: any) => fmt(s) === "time",
    isBigInt: (s: any) => fmt(s) === "bigint",
    isUuid: (s: any) => fmt(s) === "uuid",
    isEmail: (s: any) => fmt(s) === "email",
    isUrl: (s: any) => fmt(s) === "url",
    isBinary: (s: any) => fmt(s) === "binary",
    isUUID: (s: any) => fmt(s) === "uuid",
    // Explicit `: boolean` — ORs `ZodLiteral`/`ZodEnum` whose inferred predicate
    // would leak zod's non-exported `Literal`/`EnumValue` internals (TS2883).
    isScalar: (s: any): boolean =>
      s instanceof zod.ZodString ||
      s instanceof zod.ZodNumber ||
      s instanceof zod.ZodBoolean ||
      s instanceof zod.ZodNull ||
      s instanceof zod.ZodLiteral ||
      s instanceof zod.ZodEnum ||
      s instanceof zod.ZodDate,
    isSchema: (s: any) => s instanceof zod.ZodType,
    isTuple: (s: any) => s instanceof zod.ZodTuple,
    isUndefined: (s: any) => s instanceof zod.ZodUndefined,
    isUnsafe: (s: any) =>
      s instanceof zod.ZodAny || s instanceof zod.ZodUnknown,
    isVoid: (s: any) => s instanceof zod.ZodVoid,
    format: (s: any) => fmt(s),
    /** The string values of a `ZodEnum` (typebox-compat for `value.enum`). */
    enumValues: (s: any): string[] => {
      const opts = s?.options;
      if (Array.isArray(opts)) return opts as string[];
      const entries = s?._zod?.def?.entries;
      return entries ? (Object.values(entries) as string[]) : [];
    },
    /** Peel optional / nullable / default wrappers to the inner schema. */
    unwrap: (s: any): any => {
      let cur = s;
      while (
        cur instanceof zod.ZodOptional ||
        cur instanceof zod.ZodNullable ||
        cur instanceof zod.ZodDefault
      ) {
        cur =
          typeof cur.unwrap === "function"
            ? cur.unwrap()
            : cur?._zod?.def?.innerType;
      }
      return cur;
    },
    /**
     * Read a schema's default value (peeling optional/nullable wrappers), or
     * `undefined` if there is none. In zod, defaults are a `ZodDefault` wrapper
     * (not a `default` data property as in typebox), so `"default" in schema`
     * is NOT a valid test — every schema has a `.default()` method.
     */
    getDefault: (s: any): unknown => {
      // An explicit own `default` property (attached by the ORM's `default()`
      // helper via Object.assign) takes precedence over a zod ZodDefault
      // wrapper. Guarded with hasOwn so the prototype `.default()` *method* is
      // never mistaken for a default value.
      if (s && Object.hasOwn(s, "default")) return s.default;
      let cur = s;
      while (cur) {
        if (cur instanceof zod.ZodDefault) {
          const dv = cur?._zod?.def?.defaultValue;
          return typeof dv === "function" ? dv() : dv;
        }
        if (cur instanceof zod.ZodOptional || cur instanceof zod.ZodNullable) {
          cur = cur.unwrap();
          continue;
        }
        return undefined;
      }
      return undefined;
    },
    /** typebox-compat: the object's required (non-optional) field names. */
    requiredKeys: (s: any): string[] => {
      const shape = s?.shape;
      return shape
        ? Object.keys(shape).filter(
            (k) => !(shape[k] instanceof zod.ZodOptional),
          )
        : [];
    },
  },
};

export type Z = typeof z;
