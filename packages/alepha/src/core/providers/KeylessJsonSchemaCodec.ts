import { AlephaError } from "../errors/AlephaError.ts";
import { $hook } from "../primitives/$hook.ts";
import { SchemaCodec } from "./SchemaCodec.ts";
import type { TArray, TObject, TSchema, TUnion } from "./TypeProvider.ts";
import { type Static, z } from "./TypeProvider.ts";

// =============================================================================
// Keyless JSON Codec
// =============================================================================
// Schema-driven JSON encoding without keys:
// - Schema defines field order → no keys needed in output
// - Uses native JSON.stringify on arrays (fast!)
// - Uses native JSON.parse for decoding (blazing fast)
// - 50-56% smaller than JSON, decode 1.7-2x faster
//
// Example:
//   JSON:    {"name":"Alice","age":30,"active":true}  (39 bytes)
//   Keyless: ["Alice",30,true]                        (17 bytes)
// =============================================================================

export interface KeylessCodec<T = any> {
  encode: (value: T) => string;
  decode: (str: string) => T;
}

export interface KeylessCodecOptions {
  /**
   * Whether to use `new Function()` for code compilation.
   * When false, uses an interpreter-based approach (safer but slower).
   *
   * @default Auto-detected: disabled when `new Function()` throws (e.g. under
   * a restrictive CSP), enabled otherwise.
   */
  useFunctionCompilation?: boolean;
}

/**
 * KeylessJsonSchemaCodec provides schema-driven JSON encoding without keys.
 *
 * It uses the schema to determine field order, allowing the encoded output
 * to be a simple JSON array instead of an object with keys.
 */
export class KeylessJsonSchemaCodec extends SchemaCodec {
  protected readonly cache = new Map<TSchema, KeylessCodec>();
  protected readonly textEncoder = new TextEncoder();
  protected readonly textDecoder = new TextDecoder();
  protected varCounter = 0;
  protected useFunctionCompilation = true;

  /**
   * Configure codec options.
   */
  public configure(options: KeylessCodecOptions): this {
    if (options.useFunctionCompilation !== undefined) {
      this.useFunctionCompilation = options.useFunctionCompilation;
      this.cache.clear(); // Clear cache when compilation mode changes
    }
    return this;
  }

  /**
   * Hook to auto-detect safe mode on configure.
   * Disables function compilation when `new Function()` is unavailable.
   */
  protected onConfigure = $hook({
    on: "configure",
    handler: () => {
      // Auto-detect: disable function compilation when eval/Function is
      // blocked (e.g. by a restrictive CSP)
      this.useFunctionCompilation = this.canUseFunction();
    },
  });

  /**
   * Encode value to a keyless JSON string.
   */
  public encodeToString<T extends TSchema>(
    schema: T,
    value: Static<T>,
  ): string {
    return this.getCodec(schema).encode(value);
  }

  /**
   * Encode value to binary (UTF-8 encoded keyless JSON).
   */
  public encodeToBinary<T extends TSchema>(
    schema: T,
    value: Static<T>,
  ): Uint8Array {
    return this.textEncoder.encode(this.encodeToString(schema, value));
  }

  /**
   * Decode keyless JSON string or binary to value.
   */
  public decode<T>(schema: TSchema, value: unknown): T {
    if (value instanceof Uint8Array) {
      const text = this.textDecoder.decode(value);
      return this.getCodec(schema).decode(text) as T;
    }

    if (typeof value === "string") {
      return this.getCodec(schema).decode(value) as T;
    }

    // If already an array (parsed JSON), reconstruct object
    if (Array.isArray(value)) {
      return this.reconstructObject(schema, value) as T;
    }

    return value as T;
  }

  /**
   * Test if `new Function()` is available (not blocked by CSP).
   */
  protected canUseFunction(): boolean {
    try {
      const fn = new Function("return true");
      return fn() === true;
    } catch {
      return false;
    }
  }

  // ===========================================================================
  // Codec Compilation
  // ===========================================================================

  /**
   * Get a compiled codec for the given schema.
   * Codecs are cached for reuse.
   */
  protected getCodec<T>(schema: TSchema): KeylessCodec<T> {
    let c = this.cache.get(schema);
    if (!c) {
      this.assertSupported(schema);
      c = this.useFunctionCompilation
        ? this.compileWithFunction(schema)
        : this.compileInterpreted(schema);
      this.cache.set(schema, c);
    }
    return c as KeylessCodec<T>;
  }

  /**
   * Refuse schemas the positional format cannot represent.
   *
   * The encoding stores values in field order and drops the keys, so both
   * sides must agree on one layout for a given schema. Two shapes break that
   * and used to corrupt data *silently*:
   *
   * - **Unions.** A union has no single field order. The codec resolved one by
   *   taking the first non-null variant, so a value of variant B was written
   *   with variant A's layout and read back with A's keys — wrong keys,
   *   dropped fields, no error.
   * - **A wrapper at the root** (`z.object({...}).optional()`). It encodes flat
   *   but the decoder consumes a single slot, so `{a:1,b:"x"}` round-trips to
   *   `{a:1,b:1}`.
   *
   * Field-level `optional`/`nullable` are fine — they have a reserved slot.
   */
  protected assertSupported(schema: TSchema): void {
    if (this.isRootWrapper(schema)) {
      throw new AlephaError(
        "The keyless encoder does not support a top-level optional/nullable object schema: " +
          "it encodes flat but decodes as a single value. Wrap it in an object instead.",
      );
    }

    this.assertNoUnion(schema, "");
  }

  /**
   * Walks the schema on the RAW property schemas — {@link getObjectFields}
   * unwraps a union into its first variant, which is exactly the resolution
   * that loses data, so checking its output would never see one.
   */
  protected assertNoUnion(schema: TSchema, path: string): void {
    if (!schema || typeof schema !== "object") {
      return;
    }

    if (this.isRealUnion(schema)) {
      throw new AlephaError(
        `The keyless encoder does not support union schemas (at "${path || "<root>"}"): ` +
          "the format is positional and a union has no single field order. " +
          "Use the default encoder for this schema, or model the variants as one object with optional fields.",
      );
    }

    const inner = this.unwrap(schema);

    if (z.schema.isArray(inner)) {
      this.assertNoUnion((inner as TArray).items, `${path}[]`);
      return;
    }

    if (z.schema.isObject(inner)) {
      const props = (inner as TObject).properties as
        | Record<string, TSchema>
        | undefined;

      for (const key of Object.keys(props ?? {})) {
        this.assertNoUnion(props![key], path ? `${path}.${key}` : key);
      }
    }
  }

  /**
   * A union with more than one non-null variant. `[X, null]` is how the
   * typebox era spelled nullable and stays supported.
   */
  protected isRealUnion(schema: TSchema): boolean {
    if (!z.schema.isUnion(schema)) {
      return false;
    }

    // `anyOf` is the JSON-Schema spelling, `options` zod's own.
    const asAny = schema as TUnion & { options?: unknown };
    const variants = Array.isArray(asAny.anyOf)
      ? asAny.anyOf
      : Array.isArray(asAny.options)
        ? asAny.options
        : undefined;

    if (!variants) {
      return false;
    }

    return variants.filter((s: any) => !z.schema.isNull(s)).length > 1;
  }

  protected isRootWrapper(schema: TSchema): boolean {
    if (!z.schema.isOptional(schema) && !z.schema.isNullable(schema)) {
      return false;
    }

    // Only the object case is broken: a wrapped scalar occupies its one slot
    // like any other value.
    return z.schema.isObject(this.unwrap(schema));
  }

  protected nextVar(): string {
    return `_${this.varCounter++}`;
  }

  /**
   * Compile codec using `new Function()` for maximum performance.
   * Only used when CSP allows and useFunctionCompilation is true.
   */
  protected compileWithFunction(schema: TSchema): KeylessCodec {
    this.varCounter = 0;
    const encBody = this.genEnc(schema, "v");

    this.varCounter = 0;
    const decBody = this.genDec(schema);

    const encoder = new Function("v", `return JSON.stringify(${encBody});`) as (
      value: any,
    ) => string;

    const decoder = new Function(
      "s",
      `const a=JSON.parse(s);let i=0;${decBody.code}return ${decBody.result};`,
    ) as (str: string) => any;

    return { encode: encoder, decode: decoder };
  }

  /**
   * Compile codec using interpreter-based approach.
   * Safer (no eval/Function) but slower. Used in browser by default.
   */
  protected compileInterpreted(schema: TSchema): KeylessCodec {
    const self = this;

    return {
      encode(value: any): string {
        return JSON.stringify(self.interpretEncode(schema, value));
      },
      decode(str: string): any {
        const ctx = { arr: JSON.parse(str), i: 0 };
        return self.interpretDecode(schema, ctx);
      },
    };
  }

  // ===========================================================================
  // Interpreter-based Encoding (Safe Mode)
  // ===========================================================================

  protected interpretEncode(schema: TSchema, value: any): any {
    if (this.isLeaf(schema)) {
      return value;
    }

    if (z.schema.isArray(schema)) {
      const arrSchema = schema as TArray;
      if (!Array.isArray(value)) return value;

      if (z.schema.isScalar(arrSchema.items)) {
        return value;
      }
      return value.map((e) => this.interpretEncode(arrSchema.items, e));
    }

    if (z.schema.isObject(schema)) {
      const result: any[] = [];
      for (const { key, isOpt, isNullable, inner } of this.getObjectFields(
        schema as TObject,
      )) {
        const v = value[key];

        if (isOpt) {
          result.push(v !== undefined ? this.interpretEncode(inner, v) : null);
        } else if (isNullable) {
          result.push(v !== null ? this.interpretEncode(inner, v) : null);
        } else {
          result.push(this.interpretEncode(inner, v));
        }
      }
      return result;
    }

    if (z.schema.isOptional(schema) || z.schema.isUnion(schema)) {
      const inner = this.unwrap(schema);
      if (this.isNullable(schema)) {
        return value !== null ? this.interpretEncode(inner, value) : null;
      }
      return value !== undefined ? this.interpretEncode(inner, value) : null;
    }

    return value;
  }

  // ===========================================================================
  // Interpreter-based Decoding (Safe Mode)
  // ===========================================================================

  protected interpretDecode(
    schema: TSchema,
    ctx: { arr: any[]; i: number },
  ): any {
    if (this.isLeaf(schema)) {
      return ctx.arr[ctx.i++];
    }

    if (z.schema.isArray(schema)) {
      const arrSchema = schema as TArray;
      const arr = ctx.arr[ctx.i++];
      if (!Array.isArray(arr)) return arr;

      if (z.schema.isObject(arrSchema.items)) {
        return arr.map((e) =>
          this.interpretDecodeFromValue(arrSchema.items, e),
        );
      }
      return arr;
    }

    if (z.schema.isObject(schema)) {
      const result: Record<string, any> = {};

      for (const { key, isOpt, isNullable, inner } of this.getObjectFields(
        schema as TObject,
      )) {
        const val = ctx.arr[ctx.i++];

        if (isOpt) {
          if (val !== null) {
            result[key] = this.interpretDecodeFromValue(inner, val);
          }
        } else if (isNullable) {
          result[key] =
            val === null ? null : this.interpretDecodeFromValue(inner, val);
        } else {
          result[key] = this.interpretDecodeFromValue(inner, val);
        }
      }

      return result;
    }

    if (z.schema.isOptional(schema) || z.schema.isUnion(schema)) {
      const inner = this.unwrap(schema);
      const val = ctx.arr[ctx.i++];

      if (val === null) {
        return this.isNullable(schema) ? null : undefined;
      }

      if (z.schema.isObject(inner) || z.schema.isArray(inner)) {
        return this.interpretDecodeFromValue(inner, val);
      }

      return val;
    }

    return ctx.arr[ctx.i++];
  }

  protected interpretDecodeFromValue(schema: TSchema, value: any): any {
    if (this.isLeaf(schema)) {
      return value;
    }

    if (z.schema.isArray(schema)) {
      if (!Array.isArray(value)) return value;
      const arrSchema = schema as TArray;
      if (z.schema.isObject(arrSchema.items)) {
        return value.map((e) =>
          this.interpretDecodeFromValue(arrSchema.items, e),
        );
      }
      return value;
    }

    if (z.schema.isObject(schema)) {
      const objSchema = schema as TObject;
      const props = objSchema.properties as Record<string, TSchema>;
      const keys = Object.keys(props);
      const result: Record<string, any> = {};

      for (let idx = 0; idx < keys.length; idx++) {
        const k = keys[idx];
        const prop = props[k];
        const isOpt = z.schema.isOptional(prop);
        const inner = this.unwrap(prop);
        const v = value[idx];

        if (isOpt && v === null) {
          // Optional fields encoded as null should be decoded as undefined (omitted)
          continue;
        }

        if (z.schema.isObject(inner)) {
          result[k] = this.interpretDecodeFromValue(inner, v);
        } else {
          result[k] = v;
        }
      }

      return result;
    }

    return value;
  }

  // ===========================================================================
  // Encoder - generates code that returns an array representation
  // ===========================================================================

  protected genEnc(schema: TSchema, ve: string): string {
    if (this.isLeaf(schema)) {
      return ve;
    }

    if (z.schema.isArray(schema)) {
      const arrSchema = schema as TArray;
      const itemEnc = this.genEnc(arrSchema.items, "e");
      if (z.schema.isScalar(arrSchema.items)) {
        return ve;
      }
      return `${ve}.map(e=>${itemEnc})`;
    }

    if (z.schema.isObject(schema)) {
      const parts: string[] = [];
      for (const { key, isOpt, isNullable, inner } of this.getObjectFields(
        schema as TObject,
      )) {
        const sk = JSON.stringify(key);
        const access = `${ve}[${sk}]`;
        const innerEnc = this.genEnc(inner, access);

        if (isOpt) {
          parts.push(`${access}!==undefined?${innerEnc}:null`);
        } else if (isNullable) {
          parts.push(`${access}!==null?${innerEnc}:null`);
        } else {
          parts.push(innerEnc);
        }
      }

      return `[${parts.join(",")}]`;
    }

    if (z.schema.isOptional(schema) || z.schema.isUnion(schema)) {
      const inner = this.unwrap(schema);
      const innerEnc = this.genEnc(inner, ve);
      if (this.isNullable(schema)) {
        return `${ve}!==null?${innerEnc}:null`;
      }
      return `${ve}!==undefined?${innerEnc}:null`;
    }

    return ve;
  }

  // ===========================================================================
  // Decoder - generates code to reconstruct object from parsed array
  // ===========================================================================

  protected genDec(schema: TSchema): { code: string; result: string } {
    const v = this.nextVar();

    if (this.isLeaf(schema)) {
      return { code: "", result: "a[i++]" };
    }

    if (z.schema.isArray(schema)) {
      const arrSchema = schema as TArray;
      // Check if array items need transformation (objects)
      if (z.schema.isObject(arrSchema.items)) {
        const itemTransform = this.genDecFromValue(arrSchema.items, "e");
        return { code: "", result: `a[i++].map(e=>${itemTransform})` };
      }
      return { code: "", result: "a[i++]" };
    }

    if (z.schema.isObject(schema)) {
      const fields = this.getObjectFields(schema as TObject);

      // Check if simple (all required primitives)
      const simple = fields.every(
        ({ isOpt, isNullable, inner }) =>
          !isOpt &&
          !isNullable &&
          !z.schema.isObject(inner) &&
          !z.schema.isArray(inner),
      );

      if (simple) {
        const fieldExprs = fields.map(
          ({ key }) => `${JSON.stringify(key)}:a[i++]`,
        );
        return { code: "", result: `{${fieldExprs.join(",")}}` };
      }

      let code = `const ${v}={};`;
      for (const { key, isOpt, isNullable, inner } of fields) {
        const sk = JSON.stringify(key);
        if (isOpt) {
          const nested = this.genDecFromValue(inner, "t");
          code += `{const t=a[i++];if(t!==null){${v}[${sk}]=${nested};}}`;
        } else if (isNullable) {
          const nested = this.genDecFromValue(inner, "t");
          code += `{const t=a[i++];if(t===null){${v}[${sk}]=null;}else{${v}[${sk}]=${nested};}}`;
        } else if (z.schema.isObject(inner)) {
          const nested = this.genDecFromValue(inner, "a[i++]");
          code += `${v}[${sk}]=${nested};`;
        } else if (z.schema.isArray(inner)) {
          // Handle arrays - check if items need transformation
          const arrSchema = inner as TArray;
          if (z.schema.isObject(arrSchema.items)) {
            const itemTransform = this.genDecFromValue(arrSchema.items, "e");
            code += `${v}[${sk}]=a[i++].map(e=>${itemTransform});`;
          } else {
            code += `${v}[${sk}]=a[i++];`;
          }
        } else {
          code += `${v}[${sk}]=a[i++];`;
        }
      }

      return { code, result: v };
    }

    if (z.schema.isOptional(schema) || z.schema.isUnion(schema)) {
      const inner = this.unwrap(schema);
      const innerDec = this.genDec(inner);
      const nullVal = this.isNullable(schema) ? "null" : "undefined";
      return {
        code: `const ${v}t=a[i++];let ${v};if(${v}t===null){${v}=${nullVal};}else{${innerDec.code.replace(/a\[i\+\+\]/g, `${v}t`)}${v}=${innerDec.result.replace(/a\[i\+\+\]/g, `${v}t`)};}`,
        result: v,
      };
    }

    return { code: "", result: "a[i++]" };
  }

  protected genDecFromValue(schema: TSchema, expr: string): string {
    if (this.isLeaf(schema)) {
      return expr;
    }
    if (z.schema.isArray(schema)) {
      const items = schema.items as TSchema;
      if (z.schema.isObject(items)) {
        const v = this.nextVar();
        return `${expr}.map(${v}=>${this.genDecFromValue(items, v)})`;
      }
      return expr;
    }
    if (z.schema.isObject(schema)) {
      const objSchema = schema as TObject;
      const props = objSchema.properties as Record<string, TSchema>;
      const keys = Object.keys(props);
      const v = this.nextVar();
      const fields = keys.map((k, idx) => {
        const inner = this.unwrap(props[k]);
        const innerExpr = `${v}[${idx}]`;
        const sk = JSON.stringify(k);
        if (z.schema.isObject(inner)) {
          return `${sk}:${this.genDecFromValue(inner, innerExpr)}`;
        }
        return `${sk}:${innerExpr}`;
      });
      return `((${v}=${expr})=>({${fields.join(",")}}))()`;
    }
    return expr;
  }

  // ===========================================================================
  // Helpers
  // ===========================================================================

  protected isLeaf(schema: TSchema): boolean {
    return z.schema.isScalar(schema) || this.isEnum(schema);
  }

  protected getObjectFields(schema: TObject): Array<{
    key: string;
    isOpt: boolean;
    isNullable: boolean;
    inner: TSchema;
  }> {
    const props = schema.properties as Record<string, TSchema>;
    const req = new Set(z.schema.requiredKeys(schema));
    return Object.keys(props).map((key) => {
      const ps = props[key];
      return {
        key,
        isOpt: !req.has(key) || z.schema.isOptional(ps),
        isNullable: this.isNullable(ps),
        inner: this.unwrap(ps),
      };
    });
  }

  protected isEnum(schema: TSchema): boolean {
    return (
      "enum" in schema &&
      Array.isArray((schema as { enum?: unknown[] }).enum) &&
      ((schema as { enum?: unknown[] }).enum?.length ?? 0) > 0
    );
  }

  protected isNullable(schema: TSchema): boolean {
    // zod represents `z.nullable(x)` as a `ZodNullable` wrapper (and
    // `z.nullable(x).optional()` nests it inside a `ZodOptional`), so walk the
    // optional/nullable wrapper chain rather than only inspecting a union.
    let cur: any = schema;
    while (cur) {
      if (z.schema.isNullable(cur)) return true;
      if (z.schema.isOptional(cur) && typeof cur.unwrap === "function") {
        cur = cur.unwrap();
        continue;
      }
      break;
    }
    // typebox-era nullable was a union `[schema, null]`.
    if (z.schema.isUnion(schema)) {
      const unionSchema = schema as TUnion;
      return unionSchema.anyOf?.some((s: any) => z.schema.isNull(s)) ?? false;
    }
    return false;
  }

  protected unwrap(schema: TSchema): TSchema {
    // Peel zod optional/nullable/default wrappers (`z.optional`, `z.nullable`).
    // Without this the codec recurses forever on an optional field: the local
    // unwrap only knew the typebox union representation and returned the same
    // `ZodOptional` schema unchanged.
    const peeled = z.schema.unwrap(schema);
    // typebox-era nullable union `[schema, null]` — pick the first non-null.
    if (z.schema.isUnion(peeled)) {
      const unionSchema = peeled as TUnion;
      if (Array.isArray(unionSchema.anyOf)) {
        return (
          (unionSchema.anyOf.find(
            (s: any) => !z.schema.isNull(s),
          ) as TSchema) || peeled
        );
      }
    }
    return peeled;
  }

  /**
   * Reconstruct an object from a parsed array (for when input is already parsed).
   */
  protected reconstructObject(schema: TSchema, arr: any[]): any {
    if (!z.schema.isObject(schema)) return arr;

    const result: Record<string, any> = {};
    let i = 0;

    for (const { key, isOpt, isNullable, inner } of this.getObjectFields(
      schema as TObject,
    )) {
      const val = arr[i++];

      if (isOpt) {
        if (val !== null) {
          result[key] = this.reconstructField(inner, val);
        }
      } else if (isNullable) {
        result[key] = val === null ? null : this.reconstructField(inner, val);
      } else {
        result[key] = this.reconstructField(inner, val);
      }
    }

    return result;
  }

  /**
   * Rebuild one decoded field value from its keyless (positional) form.
   *
   * Nested objects recurse, and so do the ITEMS of an array of objects — the
   * encoder writes those as nested tuples, and returning the tuple verbatim
   * silently handed callers `[["x", 1]]` where the schema promised
   * `[{ a: "x", n: 1 }]`. The interpreted and compiled decode paths already
   * mapped array items back; only this one did not, so the same schema
   * decoded differently depending on which path ran.
   */
  protected reconstructField(inner: TSchema, val: any): any {
    if (z.schema.isObject(inner)) {
      return this.reconstructObject(inner, val);
    }

    if (z.schema.isArray(inner) && Array.isArray(val)) {
      const items = (inner as TArray).items as TSchema;
      if (z.schema.isObject(items)) {
        return val.map((entry) => this.reconstructObject(items, entry));
      }
    }

    return val;
  }
}
