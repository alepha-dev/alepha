import type { z as zod } from "zod";
import * as mini from "zod/mini";
import { config as zodConfig } from "zod/v4/core";
import enLocale from "zod/v4/locales/en.js";

import { installZodChain } from "./zodChain.ts";

// Re-activate zod's English error map. zod's classic entry does this as a module
// side effect (`config(en())`) so messages read "Too small: expected string to
// have >=2 characters" instead of a bare "Invalid input". zod/mini never does it,
// so we call it explicitly from alepha. Bundles only `en` (~1 KB gz).
zodConfig(enLocale());
installZodChain();

/**
 * Alepha's `z` — a thin, enhanceable wrapper over zod/mini that mirrors the
 * ergonomics of the legacy typebox `t` provider (same call-shapes, so existing
 * `t.*` call-sites become a near-mechanical rename), while delegating all
 * validation + static-type inference to zod.
 *
 * Design notes:
 * - Runs on zod/mini, typed as classic zod. `zodChain.ts` is what makes the two
 *   agree: every chained method a call site writes is defined there.
 * - No encode/decode. string -> string, number -> number. Validation is a plain
 *   `schema.parse(value)` — zod does NOT use `Function`/`eval`, so this is safe
 *   inside Cloudflare Workers (unlike typebox's `Compile`).
 * - Metadata (`title`, `description`, `format`, custom `~options`) rides on zod's
 *   native `.meta()` registry, so `z.toJSONSchema()` round-trips it for OpenAPI
 *   + form generation. Defaults use `.default()`.
 */

// ---------------------------------------------------------------------------
// The type-level surface
// ---------------------------------------------------------------------------

/**
 * Alepha's `z` carries values only — `z.infer<T>` and `z.ZodString` do not
 * resolve. So the type-level names have to be exported
 * standalone, which is what this block is for.
 *
 * Three of them are Alepha's own, because zod has no reachable equivalent
 * ({@link Infer}) or because a defaulted type parameter is load-bearing for
 * inference ({@link ZType}, {@link ZObject}). Everything else below is zod's
 * own name, re-exported verbatim: one concept, one name, wherever it is
 * imported from.
 */
export type ZType = zod.ZodType;
export type ZObject<T extends zod.ZodRawShape = any> = zod.ZodObject<T>;
/**
 * Extract the TypeScript type of a schema — `z.infer` is not reachable.
 */
export type Infer<T extends zod.ZodType> = zod.infer<T>;

export type {
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
} from "zod";

/**
 * Shallow output-extraction for `T extends SomeSchema ? Infer<T> : Fallback`
 * conditional positions.
 *
 * Reads zod's `_zod.output` directly (a single shallow conditional) instead of
 * first testing `T extends TRequestBody` / `TResponseBody` — those tests compare
 * `T` against 5-6 member unions of deeply-recursive zod class types, and that
 * structural assignability check is what trips TypeScript's instantiation-depth
 * limit (TS2589) inside `$action`'s generics. The extracted type is identical to
 * `Infer<T>` for any real schema; non-schema `T` (e.g. `undefined`) yields
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
  /**
   * Alepha string transforms, kept for JSON-Schema round-trip parity.
   */
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

/**
 * Default length caps for the `z.text()` size families.
 */
export const Z_LIMITS = {
  short: 64,
  regular: 255,
  long: 1024,
  rich: 65535,
  arrayMaxItems: 1000,
};

/**
 * Attach metadata + default without changing the schema's inferred type.
 */
const meta = <T extends zod.ZodType>(schema: T, options?: SchemaOptions): T => {
  if (!options) return schema;
  const { default: def, ...rest } = options;
  let s: any = schema;
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

/**
 * zod's native `.format` getter (uuid/email/safeint/…), guarded.
 */
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

/**
 * zod's internal type discriminator (`string` | `number` | …), wrapping-safe.
 */
const defType = (s: any): string | undefined => s?._zod?.def?.type;

/**
 * Tag a string-format schema with its JSON-Schema `format` (stays a real `ZodString`).
 */
const strFmt = (base: any, format: string): zod.ZodString =>
  meta(base, { format }) as unknown as zod.ZodString;

/**
 * JSON Schema keywords whose own keys are user-chosen NAMES, not keywords.
 *
 * {@link stripInternalMeta} must descend into their values but never filter
 * their keys: a schema is allowed to declare a property literally named
 * `~options`, and dropping it would silently delete a real field.
 */
const SCHEMA_MAP_KEYWORDS = new Set([
  "properties",
  "patternProperties",
  "dependentSchemas",
  "$defs",
  "definitions",
]);

/**
 * Drop Alepha's internal `~`-prefixed metadata from a generated JSON Schema.
 *
 * `z.text()` stores its string transforms under `~options` so the schema
 * carries its own behaviour, but that key is implementation detail. Every
 * caller of `z.toJSONSchema` publishes the result on a wire — OpenAPI, MCP
 * `tools/list`, devtools metadata, the admin parameter forms — so stripping
 * here rather than at each call site is what makes the key genuinely internal.
 * Nothing reads it back out: `jsonSchemaToZod`, the only inverse, ignores it.
 */
const stripInternalMeta = <T>(root: T): T => {
  const seen = new WeakSet<object>();

  const walk = (node: any, isSchemaNode: boolean): void => {
    if (!node || typeof node !== "object" || seen.has(node)) {
      return;
    }
    seen.add(node);

    if (Array.isArray(node)) {
      for (const item of node) {
        walk(item, true);
      }
      return;
    }

    for (const key of Object.keys(node)) {
      if (isSchemaNode && key.startsWith("~")) {
        delete node[key];
        continue;
      }
      walk(node[key], !isSchemaNode || !SCHEMA_MAP_KEYWORDS.has(key));
    }
  };

  walk(root, true);
  return root;
};

/**
 * Export a schema to JSON Schema (OpenAPI / form generation).
 *
 * Alepha's internal `~`-prefixed metadata is stripped from the result — see
 * {@link stripInternalMeta}. Callers publish this on a wire; none of them
 * should have to remember to clean it first.
 *
 * A namespace member, not a chained method: a browser bundle never calls it,
 * and that is what keeps zod's 20 kB of JSON Schema generators out of it.
 */
export const toJSONSchema = ((schema: any, params?: any) =>
  stripInternalMeta(
    mini.toJSONSchema(schema, params),
  )) as typeof zod.toJSONSchema;

// ---------------------------------------------------------------------------
// The `z` provider — mirrors `t`'s surface.
// ---------------------------------------------------------------------------

/**
 * Native zod coercion namespace (`z.coerce.number()`, `z.coerce.boolean()`…).
 * Used at the HTTP/string boundary (query, headers, env) where everything
 * arrives as a string; request bodies and the ORM stay strict (no coercion).
 */
const coerceSchema = mini.coerce as unknown as typeof zod.coerce;

const objectSchema = mini.object as unknown as typeof zod.object;

const arraySchema = mini.array as unknown as typeof zod.array;

const recordSchema = mini.record as unknown as typeof zod.record;

const tupleSchema = mini.tuple as unknown as typeof zod.tuple;

const unionSchema = mini.union as unknown as typeof zod.union;

const stringSchema = mini.string as unknown as typeof zod.string;

const numberSchema = mini.number as unknown as typeof zod.number;

const booleanSchema = mini.boolean as unknown as typeof zod.boolean;

const nullSchema = mini.null as unknown as typeof zod.null;

const anySchema = mini.any as unknown as typeof zod.any;

const voidSchema = mini.void as unknown as typeof zod.void;

const undefinedSchema = mini.undefined as unknown as typeof zod.undefined;

const literalSchema = mini.literal as unknown as typeof zod.literal;

const enumSchema = mini.enum as unknown as typeof zod.enum;

/**
 * Integer — native `z.int()` (format `safeint`, drives PG INT column).
 */
const integerSchema = mini.int as unknown as typeof zod.int;

/**
 * Free-form JSON object (`Record<string, any>`).
 */
const jsonSchema = () =>
  mini.record(mini.string(), mini.any()) as unknown as zod.ZodRecord<
    zod.ZodString,
    zod.ZodAny
  >;

/**
 * A typed passthrough — carries a TypeScript type and validates nothing.
 *
 * The legitimate use is a value whose shape is already owned and checked at
 * its own boundary, held somewhere that requires a schema anyway: an `$atom`
 * over a type an API client produces, an editor's own draft model. Writing a
 * zod mirror of those would be a second, driftable copy of a contract that
 * already exists.
 *
 * ⚠️ Never for anything crossing a trust boundary. A request body, a query
 * parameter, an env var or a database row declared this way is unvalidated
 * input wearing a type — which is worse than `z.any()`, because it reads as
 * if something checked it.
 *
 * Exposed here rather than left to `import { z } from "zod"` in the app: a
 * workspace importing zod directly resolves its own copy, and zod's branded
 * types treat two instances as structurally distinct — so the schema is
 * rejected by every alepha primitive with a type error that names neither
 * cause nor cure.
 */
const customSchema = mini.custom as unknown as typeof zod.custom;

const textSchema = (options: TextOptions = {}) => {
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
  let s: any = (mini.string() as any).max(max);
  if (trim) s = s.trim();
  if (lowercase) s = s.toLowerCase();
  return meta(applyString(s, rest), {
    ...rest,
    maxLength: max,
    "~options": { trim, lowercase },
  });
};

const shortTextSchema = (options: TextOptions = {}) =>
  textSchema({ ...options, size: "short" });

const longTextSchema = (options: TextOptions = {}) =>
  textSchema({ ...options, size: "long" });

const richTextSchema = (options: TextOptions = {}) =>
  textSchema({ ...options, size: "rich" });

const emailSchema = () => strFmt(mini.email(), "email");

const uuidSchema = () => strFmt(mini.guid(), "uuid");

const urlSchema = () => strFmt(mini.url(), "url");

const datetimeSchema = () => strFmt(mini.iso.datetime(), "date-time");

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
const dateSchema = () => strFmt(mini.iso.date(), "date");

/**
 * A closed range of calendar days, `[start, end]`.
 *
 * One field, one control, one query param. `z.dateRange().optional()` is
 * the single way to say "no filter"; there is no such thing as a range
 * with one end.
 *
 * **Both ends are mandatory, and that is the decision the rest follows
 * from.** It removes open bounds, which is the only thing an array could
 * not express, and it is what lets `.optional()` carry the whole absent
 * case. Never `["2026-01-01", ""]`.
 *
 * **The format tag sits on the ARRAY, not only on its items.** Without it
 * nothing can tell a range from an ordinary list of two dates, and
 * selecting the range picker is the whole point. Every reader keys on the
 * literal `"date-range"`, never on "array whose items are dates" - which
 * is what makes a later `date-time-range` one more literal rather than a
 * rewrite.
 *
 * `.length(2)` and not `z.tuple([...])`: a tuple emits `prefixItems`
 * (JSON Schema 2020-12), which OpenAPI 3.0 consumers do not understand,
 * and both ends are the same type so the tuple buys nothing.
 *
 * ⚠️ Resolving a day to an instant is the CALLER's job, and UTC is the
 * answer to reach for: `gte = <start>T00:00:00.000Z`,
 * `lte = <end>T23:59:59.999Z`. A reader filtering "8 Sep" arguably means
 * their local 8 Sep, but the server is not told their offset, and UTC is
 * what makes a shared link select the same rows for everyone.
 */
const dateRangeSchema = () =>
  meta(
    (mini.array(strFmt(mini.iso.date(), "date")) as any)
      .length(2)
      .refine((value: string[]) => (value[1] ?? "") >= (value[0] ?? ""), {
        message: "The end of a date range cannot be before its start.",
      }),
    { format: "date-range" },
  ) as unknown as zod.ZodArray<zod.ZodString>;

const timeSchema = () => strFmt(mini.iso.time(), "time");

/**
 * bigint as a validated string (no codec).
 */
const bigintSchema = () =>
  strFmt((mini.string() as any).regex(/^-?\d+$/), "bigint");

const binarySchema = () => strFmt(mini.string(), "binary");

const durationSchema = () => strFmt(mini.string(), "duration");

const e164Schema = () => textSchema({ pattern: "^\\+[1-9]\\d{1,14}$" });

const bcp47Schema = () => textSchema({ pattern: "^[a-z]{2,3}(?:-[A-Z]{2})?$" });

const constantCaseSchema = () => textSchema({ pattern: "^[A-Z_-]+$" });

const int32Schema = () =>
  (mini.int() as any).min(-2147483648).max(2147483647) as ReturnType<
    typeof zod.int
  >;

const int64Schema = () =>
  (mini.int() as any)
    .min(-9007199254740991)
    .max(9007199254740991)
    .meta({ format: "int64" }) as ReturnType<typeof zod.int>;

/**
 * A file field. `maxBytes` caps what the transport will accept for it.
 *
 * The unit is in the name on purpose. `$storage({ maxSize })` next door is
 * declared in **megabytes**, and two fields sharing a name while meaning
 * different units is not a documentation problem — nobody re-reads a docblock
 * for a name they believe they know. The mistake is silent in both
 * directions: bytes read as megabytes accepts a million times too much, and
 * the reverse refuses everything.
 */
const fileSchema = (options?: { maxBytes?: number }) =>
  (mini.any() as any).meta({ format: "binary", ...options }) as zod.ZodAny;

/**
 * The bytes as they arrive, consumed once.
 *
 * Takes the same `maxBytes` as {@link file} and for the same reason: a route
 * has to be able to say how much it expects. Without it a streamed field is
 * pinned to the application-wide default, which is the one number chosen
 * without knowing what any particular route is for.
 */
const streamSchema = (options?: { maxBytes?: number }) =>
  (mini.any() as any).meta({ format: "stream", ...options }) as zod.ZodAny;

const valueLabelSchema = () =>
  mini.object({
    value: constantCaseSchema() as any,
    label: textSchema() as any,
    description: longTextSchema().optional() as any,
  }) as unknown as zod.ZodObject<{
    value: ReturnType<typeof textSchema>;
    label: ReturnType<typeof textSchema>;
    description: zod.ZodOptional<ReturnType<typeof textSchema>>;
  }>;

/**
 * Pagination wrapper, mirrors `pageSchema(item)`.
 */
type PageInt = ReturnType<typeof zod.int>;
const pageSchema = <T extends zod.ZodType>(item: T) =>
  mini.object({
    content: mini.array(item as any),
    page: mini.object({
      number: mini.int(),
      size: mini.int(),
      offset: mini.int(),
      numberOfElements: mini.int(),
      totalElements: mini.optional(mini.int()),
      totalPages: mini.optional(mini.int()),
      isEmpty: mini.boolean(),
      isFirst: mini.boolean(),
      isLast: mini.boolean(),
    }),
  }) as unknown as zod.ZodObject<{
    content: zod.ZodArray<T>;
    page: zod.ZodObject<{
      number: PageInt;
      size: PageInt;
      offset: PageInt;
      numberOfElements: PageInt;
      totalElements: zod.ZodOptional<PageInt>;
      totalPages: zod.ZodOptional<PageInt>;
      isEmpty: zod.ZodBoolean;
      isFirst: zod.ZodBoolean;
      isLast: zod.ZodBoolean;
    }>;
  }>;

/**
 * Runtime type guards (`z.schema.*`) — schema introspection for ORM + forms.
 */
const schemaSchema = {
  isOptional: (s: any): s is zod.ZodOptional =>
    s instanceof (mini.ZodMiniOptional as any),
  isDefault: (s: any): s is zod.ZodDefault =>
    s instanceof (mini.ZodMiniDefault as any),
  isObject: (s: any): s is zod.ZodObject =>
    s instanceof (mini.ZodMiniObject as any),
  isString: (s: any) => defType(s) === "string",
  isNumber: (s: any) => defType(s) === "number",
  isBoolean: (s: any): s is zod.ZodBoolean =>
    s instanceof (mini.ZodMiniBoolean as any),
  isArray: (s: any): s is zod.ZodArray =>
    s instanceof (mini.ZodMiniArray as any),
  isUnion: (s: any): s is zod.ZodUnion =>
    s instanceof (mini.ZodMiniUnion as any),
  isNull: (s: any): s is zod.ZodNull => s instanceof (mini.ZodMiniNull as any),
  isRecord: (s: any): s is zod.ZodRecord =>
    s instanceof (mini.ZodMiniRecord as any),
  // Explicit `: boolean` (not an inferred type-predicate): the `s is ZodEnum`
  // / `s is ZodLiteral` predicates leak zod's non-exported `EnumValue` /
  // `Literal` internals into consumers' generated `.d.ts` (TS2883). No
  // call-site relies on narrowing these — they read via `enumValues`/`.value`.
  isEnum: (s: any): boolean => s instanceof (mini.ZodMiniEnum as any),
  isLiteral: (s: any): boolean => s instanceof (mini.ZodMiniLiteral as any),
  isAny: (s: any): s is zod.ZodAny => s instanceof (mini.ZodMiniAny as any),
  isNullable: (s: any): s is zod.ZodNullable =>
    s instanceof (mini.ZodMiniNullable as any),
  isInteger: (s: any) => defType(s) === "number" && nativeFmt(s) === "safeint",
  isText: (s: any) => defType(s) === "string" && !fmt(s),
  isDateTime: (s: any) => fmt(s) === "date-time",
  isDate: (s: any) => fmt(s) === "date",
  /**
   * A `dateRangeSchema()`, keyed on the format literal the ARRAY carries.
   *
   * ⚠️ Never "an array whose items are dates". That test cannot tell a
   * range from an ordinary list of two days, and it is also what would make
   * a later `date-time-range` a rewrite instead of a second literal.
   */
  isDateRange: (s: any) => fmt(s) === "date-range",
  isTime: (s: any) => fmt(s) === "time",
  isBigInt: (s: any) => fmt(s) === "bigint",
  isUuid: (s: any) => fmt(s) === "uuid",
  isEmail: (s: any) => fmt(s) === "email",
  isUrl: (s: any) => fmt(s) === "url",
  isBinary: (s: any) => fmt(s) === "binary",
  // Explicit `: boolean` — ORs `ZodLiteral`/`ZodEnum` whose inferred predicate
  // would leak zod's non-exported `Literal`/`EnumValue` internals (TS2883).
  isScalar: (s: any): boolean =>
    s instanceof (mini.ZodMiniString as any) ||
    s instanceof (mini.ZodMiniNumber as any) ||
    s instanceof (mini.ZodMiniBoolean as any) ||
    s instanceof (mini.ZodMiniNull as any) ||
    s instanceof (mini.ZodMiniLiteral as any) ||
    s instanceof (mini.ZodMiniEnum as any) ||
    s instanceof (mini.ZodMiniDate as any),
  isSchema: (s: any): s is zod.ZodType =>
    s instanceof (mini.ZodMiniType as any),
  isTuple: (s: any): s is zod.ZodTuple =>
    s instanceof (mini.ZodMiniTuple as any),
  isUndefined: (s: any): s is zod.ZodUndefined =>
    s instanceof (mini.ZodMiniUndefined as any),
  isUnsafe: (s: any) =>
    s instanceof (mini.ZodMiniAny as any) ||
    s instanceof (mini.ZodMiniUnknown as any),
  isVoid: (s: any): s is zod.ZodVoid => s instanceof (mini.ZodMiniVoid as any),
  format: (s: any) => fmt(s),
  /**
   * Everything a schema was tagged with via `.meta()`.
   *
   * `format` above reads one key out of this; a walker that needs another -
   * the `maxSize` a `fileSchema()` carries, say - would otherwise have to reach
   * into zod's internals at the call site, which is exactly the coupling this
   * namespace exists to prevent.
   *
   * ⚠️ The optional / nullable / default wrappers are walked, and the layers
   * merged from the inside out. `.meta()` registers against ONE schema
   * instance, and every wrapper is a new instance, so
   * `enumSchema([...]).default("a").meta({ title })` puts the title on the
   * `ZodDefault` while `enumSchema([...]).meta({ title }).default("a")` puts it
   * on the enum. Reading either end alone makes half the call sites silently
   * lose their annotation - a form field that falls back to its prettified
   * property name is what that looks like.
   *
   * An outer layer wins on a key both carry, being the later annotation.
   */
  meta: (s: any): Record<string, any> => {
    const layers: any[] = [];
    let cur = s;
    while (
      cur instanceof (mini.ZodMiniOptional as any) ||
      cur instanceof (mini.ZodMiniNullable as any) ||
      cur instanceof (mini.ZodMiniDefault as any)
    ) {
      layers.push(cur);
      cur =
        typeof cur.unwrap === "function"
          ? cur.unwrap()
          : cur?._zod?.def?.innerType;
    }
    layers.push(cur);

    const out: Record<string, any> = {};
    // Innermost first, so an outer wrapper's annotation overwrites it.
    for (const layer of layers.toReversed()) {
      try {
        Object.assign(out, layer?.meta?.() ?? {});
      } catch {
        // A schema whose `.meta()` throws contributes nothing, rather than
        // taking the whole read down with it.
      }
    }
    return out;
  },

  // -- structural accessors ------------------------------------------------
  // Zod names these `.shape` / `.element` / `.options`, and a schema-walker
  // has to reach for them constantly. They live here rather than as
  // prototype aliases on zod's own classes: patching a third-party prototype
  // is a process-wide side effect on a library the application also imports,
  // so two copies of zod in the tree leave one of them silently unpatched.

  /**
   * Property schemas of a `ZodObject`. Empty object for anything else.
   */
  shape: (s: any): Record<string, ZType> => s?.shape ?? {},

  /**
   * Element schema of a `ZodArray`, or `undefined`.
   */
  element: (s: any): ZType | undefined => s?.element,

  /**
   * Member schemas of a `ZodUnion`. Empty array for anything else.
   */
  options: (s: any): ZType[] =>
    Array.isArray(s?.options) ? (s.options as ZType[]) : [],

  /**
   * Element schemas of a `ZodTuple`.
   *
   * A tuple keeps them at `_zod.def.items` rather than exposing a public
   * accessor, which is why this is not simply `s.items`.
   */
  items: (s: any): ZType[] => {
    const items = s?._zod?.def?.items;
    return Array.isArray(items) ? (items as ZType[]) : [];
  },
  /**
   * The string options accepted by a `ZodEnum`.
   */
  enumOptions: (s: any): string[] => {
    const opts = s?.options;
    if (Array.isArray(opts)) return opts as string[];
    const entries = s?._zod?.def?.entries;
    return entries ? (Object.values(entries) as string[]) : [];
  },
  /**
   * Peel optional / nullable / default wrappers to the inner schema.
   */
  unwrap: (s: any): any => {
    let cur = s;
    while (
      cur instanceof (mini.ZodMiniOptional as any) ||
      cur instanceof (mini.ZodMiniNullable as any) ||
      cur instanceof (mini.ZodMiniDefault as any)
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
   * so `"default" in schema`
   * is not a valid test: every schema has a `.default()` method.
   */
  defaultValue: (s: any): unknown => {
    // An explicit own `default` property (attached by the ORM's `default()`
    // helper via Object.assign) takes precedence over a zod ZodDefault
    // wrapper.
    //
    // ⚠️ `hasOwn` alone is NOT the guard it reads as. zod 4 installs its
    // `.default()` METHOD as an own property the first time that method is
    // called on a schema, so any schema someone has chained `.default()` on
    // anywhere — a shared enum with `.default("month")` in a settings atom,
    // reused as an entity column — reports an own `default` that is the
    // function. It was then read as a function-valued column default, which
    // breaks the schema sync.
    //
    // The ORM only ever attaches a VALUE (`Object.assign(type, { default:
    // value })`, typed `Infer<T>` and skipped when nullish), so a function
    // here is always zod's method and never a column default.
    if (s && Object.hasOwn(s, "default") && typeof s.default !== "function") {
      return s.default;
    }
    let cur = s;
    while (cur) {
      if (cur instanceof (mini.ZodMiniDefault as any)) {
        const dv = cur?._zod?.def?.defaultValue;
        return typeof dv === "function" ? dv() : dv;
      }
      if (
        cur instanceof (mini.ZodMiniOptional as any) ||
        cur instanceof (mini.ZodMiniNullable as any)
      ) {
        cur = cur.unwrap();
        continue;
      }
      return undefined;
    }
    return undefined;
  },
  /**
   * The object's required input field names, meaning the keys a
   * caller has to supply for the object to parse.
   *
   * A key is required unless its schema is optional or carries a default,
   * with `.optional()` / `.nullable()` / `.default()` peeled in any order:
   * `.default()` answers for the caller, so a defaulted field is no more
   * required than an optional one.
   *
   * Plain `.nullable()` stays required: `null` is a value, and the key still
   * has to be there to carry it.
   *
   * This is NOT the question "may this column be NULL". A defaulted column
   * is still `NOT NULL` - the default is what fills it - so the ORM model
   * builders ask `isOptional` directly rather than reading this array.
   */
  requiredInputKeys: (s: any): string[] => {
    const shape = s?.shape;
    if (!shape) return [];
    return Object.keys(shape).filter((k) => {
      let cur = shape[k];
      while (cur) {
        if (
          cur instanceof (mini.ZodMiniOptional as any) ||
          cur instanceof (mini.ZodMiniDefault as any)
        ) {
          return false;
        }
        if (cur instanceof (mini.ZodMiniNullable as any)) {
          cur =
            typeof cur.unwrap === "function"
              ? cur.unwrap()
              : cur?._zod?.def?.innerType;
          continue;
        }
        return true;
      }
      return true;
    });
  },
};

export {
  coerceSchema as coerce,
  objectSchema as object,
  arraySchema as array,
  recordSchema as record,
  tupleSchema as tuple,
  unionSchema as union,
  stringSchema as string,
  numberSchema as number,
  booleanSchema as boolean,
  nullSchema as null,
  anySchema as any,
  voidSchema as void,
  undefinedSchema as undefined,
  literalSchema as literal,
  enumSchema as enum,
  integerSchema as integer,
  jsonSchema as json,
  customSchema as custom,
  textSchema as text,
  shortTextSchema as shortText,
  longTextSchema as longText,
  richTextSchema as richText,
  emailSchema as email,
  uuidSchema as uuid,
  urlSchema as url,
  datetimeSchema as datetime,
  dateSchema as date,
  dateRangeSchema as dateRange,
  timeSchema as time,
  bigintSchema as bigint,
  binarySchema as binary,
  durationSchema as duration,
  e164Schema as e164,
  bcp47Schema as bcp47,
  constantCaseSchema as constantCase,
  int32Schema as int32,
  int64Schema as int64,
  fileSchema as file,
  streamSchema as stream,
  valueLabelSchema as valueLabel,
  pageSchema as page,
  schemaSchema as schema,
};
