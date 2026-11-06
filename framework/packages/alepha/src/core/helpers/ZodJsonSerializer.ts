import { util } from "zod/v4/core";

import { ZodJitObjectFactory } from "./zodJitObject.ts";

/**
 * The JSON text of a value under a zod schema, without its constraint checks.
 *
 * ## Why
 *
 * Encoding a response used to be `JSON.stringify(schema.parse(value))`. The
 * parse does two jobs: it SHAPES the value (strips undeclared keys, fills
 * defaults, trims and lowercases strings) and it CHECKS it (lengths, ranges,
 * patterns, formats). On a 100-row list the parse was most of the encoding:
 * 18 to 25 µs against 4 for `JSON.stringify` alone. This shapes the value
 * into a plain copy, with a shaper built once per schema, skips the checks,
 * and lets one native `JSON.stringify` write the copy: the same text.
 *
 * Writing the JSON itself, field by field, was tried first and lost: a
 * `JSON.stringify` per string and a concatenated result cost as much as the
 * parse, and the concatenated string was slower to measure and compress.
 *
 * ## What it keeps
 *
 * - The shape: only declared keys, in declaration order; defaults for absent
 *   values; zod's overwrite checks (`trim`, `toLowerCase`) on strings.
 * - The types: a string must be a string, a number a finite number (an
 *   integer for `z.integer()`), an enum or literal one of its values, an
 *   object an object, an array an array. A value that fails one makes
 *   {@link serialize} answer `undefined`, and the caller parses as before:
 *   wrong-typed data still fails the way it always did.
 *
 * What it drops is every other check: `max`/`min`, ranges, regexes, string
 * formats (uuid, email, date), refinements.
 *
 * ## What it refuses
 *
 * A schema it does not fully understand gets no shaper, and the caller
 * parses as before: unions, pipes and transforms, catchall objects (strict,
 * passthrough), coercion, overwrite checks on anything but a string, a
 * `__proto__` key, and every other zod type. Refusing is always safe;
 * guessing is not.
 *
 * Built from closures. An object's copy is built by a literal generated
 * with `new Function` where zod's own compiled parser runs (see
 * {@link compileObject}); where eval is refused (Cloudflare Workers, a
 * strict CSP, the browser) the closures alone serve.
 */
export class ZodJsonSerializer {
  /**
   * Thrown by a shaper whose value fails a type guard, and caught by
   * {@link serialize}. One shared object: a mismatch is the rare path, and
   * allocating an error for it would cost a stack trace.
   */
  protected static readonly MISMATCH = { mismatch: true };

  /**
   * A shaper per schema; `null` for a schema it refuses.
   */
  protected readonly shapers = new WeakMap<object, Shaper | null>();

  /**
   * The JSON text of `value` under `schema`, or `undefined` when the schema
   * has no shaper or the value does not match its types: parse instead.
   */
  public serialize(schema: unknown, value: unknown): string | undefined {
    const shape = this.shaper(schema);
    if (!shape) {
      return undefined;
    }
    let shaped: unknown;
    try {
      shaped = shape(value);
    } catch (error) {
      if (error === ZodJsonSerializer.MISMATCH) {
        return undefined;
      }
      throw error;
    }
    return JSON.stringify(shaped);
  }

  /**
   * Whether `schema` has a shaper.
   */
  public supports(schema: unknown): boolean {
    return this.shaper(schema) !== null;
  }

  protected shaper(schema: unknown): Shaper | null {
    if (typeof schema !== "object" || schema === null) {
      return null;
    }
    let shape = this.shapers.get(schema);
    if (shape === undefined) {
      shape = this.build(schema as ZodLike);
      this.shapers.set(schema, shape);
    }
    return shape;
  }

  protected build(schema: ZodLike): Shaper | null {
    const def = schema?._zod?.def;
    if (!def) {
      return null;
    }

    // Overwrite checks change the value; every other check only judges it.
    const overwrites: Array<(value: any) => any> = [];
    for (const check of def.checks ?? []) {
      const checkDef = check?._zod?.def;
      if (checkDef?.check === "overwrite") {
        if (typeof checkDef.tx !== "function") {
          return null;
        }
        overwrites.push(checkDef.tx);
      }
    }
    if (overwrites.length > 0 && def.type !== "string") {
      return null;
    }

    const mismatch = ZodJsonSerializer.MISMATCH;

    switch (def.type) {
      case "string": {
        if (def.coerce) {
          return null;
        }
        if (overwrites.length === 0) {
          return (value) => {
            if (typeof value !== "string") throw mismatch;
            return value;
          };
        }
        if (overwrites.length === 1) {
          const tx = overwrites[0];
          return (value) => {
            if (typeof value !== "string") throw mismatch;
            return tx(value);
          };
        }
        return (value) => {
          if (typeof value !== "string") throw mismatch;
          let out: any = value;
          for (const tx of overwrites) {
            out = tx(out);
          }
          return out;
        };
      }

      case "number": {
        if (def.coerce) {
          return null;
        }
        const integer =
          def.format === "safeint" ||
          def.format === "int32" ||
          def.format === "uint32";
        if (integer) {
          return (value) => {
            if (typeof value !== "number" || !Number.isInteger(value)) {
              throw mismatch;
            }
            return value;
          };
        }
        return (value) => {
          if (typeof value !== "number" || !Number.isFinite(value)) {
            throw mismatch;
          }
          return value;
        };
      }

      case "boolean": {
        if (def.coerce) {
          return null;
        }
        return (value) => {
          if (typeof value !== "boolean") throw mismatch;
          return value;
        };
      }

      case "null":
        return (value) => {
          if (value !== null) throw mismatch;
          return null;
        };

      case "enum": {
        const values = new Set(Object.values(def.entries ?? {}));
        return (value) => {
          if (!values.has(value)) throw mismatch;
          return value;
        };
      }

      case "literal": {
        const values = new Set(def.values ?? []);
        return (value) => {
          if (!values.has(value)) throw mismatch;
          return value;
        };
      }

      // Passed through by zod as they are, and written by JSON.stringify as
      // they were after a parse.
      case "any":
      case "unknown":
        return (value) => value;

      case "optional": {
        const inner = this.build(def.innerType);
        if (!inner) return null;
        return (value) => (value === undefined ? undefined : inner(value));
      }

      case "nullable": {
        const inner = this.build(def.innerType);
        if (!inner) return null;
        return (value) => (value === null ? null : inner(value));
      }

      // zod returns the default value as it is, without parsing it.
      case "default": {
        const inner = this.build(def.innerType);
        if (!inner) return null;
        return (value) =>
          value === undefined ? def.defaultValue : inner(value);
      }

      case "readonly":
        return this.build(def.innerType);

      case "array": {
        const element = this.build(def.element);
        if (!element) return null;
        return (value) => {
          if (!Array.isArray(value)) throw mismatch;
          // `slice`, then overwrite in place: one allocation of the right
          // length, where pushing would grow the copy as it goes.
          const out: unknown[] = value.slice();
          for (let i = 0; i < out.length; i++) {
            out[i] = element(out[i]);
          }
          return out;
        };
      }

      case "object": {
        if (def.catchall) {
          return null;
        }
        const shape = def.shape ?? {};
        const keys = Object.keys(shape);
        const fields: Shaper[] = [];
        for (const key of keys) {
          // Assigning `__proto__` sets the prototype instead of a key.
          if (key === "__proto__") return null;
          const field = this.build(shape[key]);
          if (!field) return null;
          fields.push(field);
        }
        const compiled = this.compileObject(keys, fields);
        if (compiled) {
          return compiled;
        }
        const count = keys.length;
        return (value) => {
          if (
            typeof value !== "object" ||
            value === null ||
            Array.isArray(value)
          ) {
            throw mismatch;
          }
          const input = value as Record<string, unknown>;
          const out: Record<string, unknown> = {};
          for (let i = 0; i < count; i++) {
            const shaped = fields[i](input[keys[i]]);
            if (shaped !== undefined) {
              out[keys[i]] = shaped;
            }
          }
          return out;
        };
      }

      case "record": {
        const keyDef = def.keyType?._zod?.def;
        if (!keyDef || keyDef.type !== "string" || keyDef.coerce) {
          return null;
        }
        // A transformed key could collide with another, which zod resolves
        // by assignment order: leave that to the parser.
        for (const check of keyDef.checks ?? []) {
          if (check?._zod?.def?.check === "overwrite") return null;
        }
        const entry = this.build(def.valueType);
        if (!entry) return null;
        return (value) => {
          if (
            typeof value !== "object" ||
            value === null ||
            Array.isArray(value)
          ) {
            throw mismatch;
          }
          const input = value as Record<string, unknown>;
          const out: Record<string, unknown> = {};
          for (const key of Object.keys(input)) {
            if (key === "__proto__") throw mismatch;
            const shaped = entry(input[key]);
            if (shaped !== undefined) {
              out[key] = shaped;
            }
          }
          return out;
        };
      }

      default:
        return null;
    }
  }

  /**
   * An object shaper that builds its copy as one object literal of the
   * declared keys, generated with `new Function`, or `undefined` where eval
   * is refused or unwelcome (the same rule as zod's compiled parser, see
   * `ZodJitObjectFactory`): the closure loop above serves there.
   *
   * A literal gives every copy of one schema the same hidden class, where a
   * loop of keyed stores reshapes each copy key by key: on a 100-row list,
   * 10.6 µs against about 5. A key whose value shapes to `undefined` stays
   * in the literal, which `JSON.stringify` leaves out, as the loop does.
   *
   * The generated source holds only the schema's own key names, quoted by
   * `JSON.stringify`, and indices: never a value.
   */
  protected compileObject(
    keys: string[],
    fields: Shaper[],
  ): Shaper | undefined {
    if (!ZodJitObjectFactory.enabled() || !util.allowsEval.value) {
      return undefined;
    }
    const props = keys
      .map(
        (key, i) =>
          `${JSON.stringify(key)}: f[${i}](v[${JSON.stringify(key)}])`,
      )
      .join(",\n");
    try {
      // The point of this method, gated by the eval policy above; the source
      // holds key names quoted by JSON.stringify and indices, never a value.
      // oxlint-disable-next-line typescript/no-implied-eval
      return new Function(
        "f",
        "m",
        `return function (v) {
  if (typeof v !== "object" || v === null || Array.isArray(v)) throw m;
  return {\n${props}\n};
};`,
      )(fields, ZodJsonSerializer.MISMATCH) as Shaper;
    } catch {
      return undefined;
    }
  }
}

/**
 * A value shaped as the schema's parse would have shaped it, without its
 * checks; throws {@link ZodJsonSerializer.MISMATCH} on a type mismatch.
 */
type Shaper = (value: unknown) => unknown;

/**
 * The part of a zod schema the serializer reads.
 */
type ZodLike = { _zod?: { def?: any } } | undefined;
