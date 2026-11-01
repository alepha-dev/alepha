import * as mini from "zod/mini";
import { globalRegistry } from "zod/v4/core";

/**
 * zod's classic method surface, on zod/mini's classes.
 *
 * Classic costs a browser bundle twice what mini does: its 15 kB of methods
 * reference zod's JSON Schema generators from every type, so tree shaking cannot
 * remove the 20 kB those weigh. This layer is the part of classic Alepha needs:
 * each method is one line over a mini function, so `z.text().optional()` keeps
 * reading the way it always has.
 *
 * ⚠️ `z`'s types stay classic's, so a member missing here compiles and then throws
 * "is not a function". `zodChain.spec.ts` freezes the list of what is left out.
 *
 * The members land non-enumerable on each class's prototype. zod binds every
 * ENUMERABLE prototype member onto every instance it builds, which would be
 * sixty binds per schema.
 */

const isNumeric = (s: any) =>
  ["number", "bigint", "date"].includes(s._zod.def.type);
/**
 * The tightest bound a schema's checks declare. zod 4.6 keeps these on each check,
 * and classic's own fold (`aggregateChecks`) lives beside the JSON Schema code.
 */
const bound = (
  s: any,
  check: string,
  key: string,
  pick: typeof Math.max,
  seed?: number,
) => {
  let out = seed;
  for (const c of s._zod.def.checks ?? []) {
    const def = c._zod.def;
    if (def.check === check)
      out = out === undefined ? def[key] : pick(out, def[key]);
  }
  return out ?? null;
};
const withMeta = (s: any, meta: Record<string, unknown>) => {
  const copy = s.clone();
  globalRegistry.add(copy, { ...globalRegistry.get(s), ...meta });
  return copy;
};
const chain: Record<string, (this: any, ...args: any[]) => any> = {
  optional() {
    return mini.optional(this);
  },
  nullable() {
    return mini.nullable(this);
  },
  nullish() {
    return mini.nullish(this);
  },
  default(value) {
    return mini._default(this, value);
  },
  prefault(value) {
    return mini.prefault(this, value);
  },
  meta(value) {
    return value === undefined
      ? globalRegistry.get(this)
      : withMeta(this, value);
  },
  describe(description) {
    return withMeta(this, { description });
  },
  refine(fn, params) {
    return this.check(mini.refine(fn, params));
  },
  superRefine(fn) {
    return this.check(mini.superRefine(fn));
  },
  transform(fn) {
    return mini.pipe(this, mini.transform(fn));
  },
  pipe(target) {
    return mini.pipe(this, target);
  },
  or(other) {
    return mini.union([this, other]);
  },
  array() {
    return mini.array(this);
  },
  catch(value) {
    // oxlint-disable-next-line promise/valid-params -- zod's `catch`, not a Promise's
    return mini.catch(this, value);
  },
  min(value, params) {
    return this.check(
      isNumeric(this) ? mini.gte(value, params) : mini.minLength(value, params),
    );
  },
  max(value, params) {
    return this.check(
      isNumeric(this) ? mini.lte(value, params) : mini.maxLength(value, params),
    );
  },
  gt(value, params) {
    return this.check(mini.gt(value, params));
  },
  gte(value, params) {
    return this.check(mini.gte(value, params));
  },
  lt(value, params) {
    return this.check(mini.lt(value, params));
  },
  lte(value, params) {
    return this.check(mini.lte(value, params));
  },
  positive(params) {
    return this.check(mini.positive(params));
  },
  nonnegative(params) {
    return this.check(mini.nonnegative(params));
  },
  int(params) {
    return this.check(mini.int(params));
  },
  finite() {
    return this;
  },
  extract(values) {
    return mini.enum(values);
  },
  exclude(values) {
    return mini.enum(this.options.filter((v: string) => !values.includes(v)));
  },
  negative(params) {
    return this.check(mini.negative(params));
  },
  nonpositive(params) {
    return this.check(mini.nonpositive(params));
  },
  readonly() {
    return mini.readonly(this);
  },
  and(other) {
    return mini.intersection(this, other);
  },
  merge(other) {
    return mini.extend(this, other.shape);
  },
  multipleOf(value, params) {
    return this.check(mini.multipleOf(value, params));
  },
  length(value, params) {
    return this.check(mini.length(value, params));
  },
  nonempty(params) {
    return this.check(mini.minLength(1, params));
  },
  regex(pattern, params) {
    return this.check(mini.regex(pattern, params));
  },
  startsWith(value, params) {
    return this.check(mini.startsWith(value, params));
  },
  endsWith(value, params) {
    return this.check(mini.endsWith(value, params));
  },
  includes(value, params) {
    return this.check(mini.includes(value, params));
  },
  trim() {
    return this.check(mini.trim());
  },
  toLowerCase() {
    return this.check(mini.toLowerCase());
  },
  toUpperCase() {
    return this.check(mini.toUpperCase());
  },
  extend(shape) {
    return mini.extend(this, shape);
  },
  safeExtend(shape) {
    return mini.safeExtend(this, shape);
  },
  pick(mask) {
    return mini.pick(this, mask);
  },
  omit(mask) {
    return mini.omit(this, mask);
  },
  partial(mask) {
    return mini.partial(this, mask);
  },
  required(mask) {
    return mini.required(this, mask);
  },
  strict() {
    return this.clone({ ...this._zod.def, catchall: mini.never() });
  },
  loose() {
    return this.clone({ ...this._zod.def, catchall: mini.unknown() });
  },
  passthrough() {
    return this.clone({ ...this._zod.def, catchall: mini.unknown() });
  },
  catchall(schema) {
    return mini.catchall(this, schema);
  },
  keyof() {
    return mini.keyof(this);
  },
  unwrap() {
    return this._zod.def.innerType ?? this._zod.def.element;
  },
};
const getters: Record<string, (this: any) => unknown> = {
  description() {
    return globalRegistry.get(this)?.description;
  },
  format() {
    return this._zod.bag.format ?? this._zod.def.format ?? null;
  },
  minLength() {
    return bound(this, "min_length", "minimum", Math.max);
  },
  maxLength() {
    return bound(this, "max_length", "maximum", Math.min);
  },
  minValue() {
    return bound(
      this,
      "greater_than",
      "value",
      Math.max,
      this._zod.bag.minimum,
    );
  },
  maxValue() {
    return bound(this, "less_than", "value", Math.min, this._zod.bag.maximum);
  },
  element() {
    return this._zod.def.element;
  },
  options() {
    return this._zod.def.options;
  },
  value() {
    return this._zod.def.values?.[0];
  },
  values() {
    return this._zod.values;
  },
  enum() {
    return this._zod.def.entries;
  },
  in() {
    return this._zod.def.in;
  },
  out() {
    return this._zod.def.out;
  },
};
export const installZodChain = (): void => {
  for (const cls of [
    mini.ZodMiniType,
    mini.ZodMiniString,
    mini.ZodMiniStringFormat,
    mini.ZodMiniEmail,
    mini.ZodMiniGUID,
    mini.ZodMiniURL,
    mini.iso.ZodMiniISODateTime,
    mini.iso.ZodMiniISODate,
    mini.iso.ZodMiniISOTime,
    mini.ZodMiniNumber,
    mini.ZodMiniNumberFormat,
    mini.ZodMiniBoolean,
    mini.ZodMiniBigInt,
    mini.ZodMiniNull,
    mini.ZodMiniUndefined,
    mini.ZodMiniVoid,
    mini.ZodMiniAny,
    mini.ZodMiniUnknown,
    mini.ZodMiniDate,
    mini.ZodMiniArray,
    mini.ZodMiniObject,
    mini.ZodMiniUnion,
    mini.ZodMiniIntersection,
    mini.ZodMiniTuple,
    mini.ZodMiniRecord,
    mini.ZodMiniEnum,
    mini.ZodMiniLiteral,
    mini.ZodMiniTransform,
    mini.ZodMiniOptional,
    mini.ZodMiniNullable,
    mini.ZodMiniDefault,
    mini.ZodMiniPrefault,
    mini.ZodMiniCatch,
    mini.ZodMiniReadonly,
    mini.ZodMiniPipe,
    mini.ZodMiniCustom,
  ] as any[]) {
    for (const [name, value] of Object.entries(chain)) {
      Object.defineProperty(cls.prototype, name, {
        value,
        writable: true,
        configurable: true,
      });
    }
    for (const [name, get] of Object.entries(getters)) {
      if (name in cls.prototype) continue;
      Object.defineProperty(cls.prototype, name, {
        get,
        set(value) {
          Object.defineProperty(this, name, {
            value,
            writable: true,
            configurable: true,
          });
        },
        configurable: true,
      });
    }
  }
};
