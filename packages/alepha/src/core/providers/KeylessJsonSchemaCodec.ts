import type { TArray, TObject, TSchema, TUnion } from "typebox";
import { AlephaError } from "../errors/AlephaError.ts";
import { $hook } from "../primitives/$hook.ts";
import { SchemaCodec } from "./SchemaCodec.ts";
import { type Static, t } from "./TypeProvider.ts";

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

// Security: Keys that could enable prototype pollution attacks
const UNSAFE_KEYS = new Set(["__proto__", "constructor", "prototype"]);

export interface KeylessCodec<T = any> {
  encode: (value: T) => string;
  decode: (str: string) => T;
}

export interface KeylessCodecOptions {
  /**
   * Whether to use `new Function()` for code compilation.
   * When false, uses an interpreter-based approach (safer but slower).
   *
   * @default Auto-detected: false in browser (CSP compatibility), true on server
   */
  useFunctionCompilation?: boolean;

  /**
   * Maximum allowed array length during encoding/decoding.
   * Prevents DoS attacks via large arrays.
   *
   * @default 10000
   */
  maxArrayLength?: number;

  /**
   * Maximum allowed string length during encoding/decoding.
   * Prevents DoS attacks via large strings.
   *
   * @default 1000000 (1MB)
   */
  maxStringLength?: number;

  /**
   * Maximum recursion depth for nested objects.
   * Prevents stack overflow attacks.
   *
   * @default 50
   */
  maxDepth?: number;
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

  // Options with defaults
  protected useFunctionCompilation = true;
  protected maxArrayLength = 10000;
  protected maxStringLength = 1000000;
  protected maxDepth = 50;

  /**
   * Configure codec options.
   */
  public configure(options: KeylessCodecOptions): this {
    if (options.useFunctionCompilation !== undefined) {
      this.useFunctionCompilation = options.useFunctionCompilation;
      this.cache.clear(); // Clear cache when compilation mode changes
    }
    if (options.maxArrayLength !== undefined) {
      this.maxArrayLength = options.maxArrayLength;
    }
    if (options.maxStringLength !== undefined) {
      this.maxStringLength = options.maxStringLength;
    }
    if (options.maxDepth !== undefined) {
      this.maxDepth = options.maxDepth;
    }
    return this;
  }

  /**
   * Hook to auto-detect safe mode on configure.
   * Disables function compilation in browser by default.
   */
  protected onConfigure = $hook({
    on: "configure",
    handler: () => {
      // Auto-detect: disable function compilation in browser (CSP compatibility)
      // and test if eval/Function is available
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
    this.validateSchemaKeys(schema);
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
    this.validateSchemaKeys(schema);

    if (value instanceof Uint8Array) {
      const text = this.textDecoder.decode(value);
      return this.getCodec(schema).decode(text) as T;
    }

    if (typeof value === "string") {
      this.validateStringLength(value);
      return this.getCodec(schema).decode(value) as T;
    }

    // If already an array (parsed JSON), reconstruct object
    if (Array.isArray(value)) {
      this.validateArrayLength(value);
      return this.reconstructObject(schema, value, 0) as T;
    }

    return value as T;
  }

  // ===========================================================================
  // Security Validation
  // ===========================================================================

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

  /**
   * Validate schema keys for prototype pollution.
   * Uses a visited set to avoid infinite recursion on recursive schemas.
   */
  protected validateSchemaKeys(
    schema: TSchema,
    depth = 0,
    visited = new Set<TSchema>(),
  ): void {
    // Avoid infinite recursion on recursive schemas
    if (visited.has(schema)) {
      return;
    }
    visited.add(schema);

    if (depth > this.maxDepth) {
      throw new AlephaError(
        `Schema depth exceeds maximum allowed (${this.maxDepth})`,
      );
    }

    if (t.schema.isObject(schema)) {
      const objSchema = schema as TObject;
      const props = objSchema.properties as Record<string, TSchema>;

      for (const key of Object.keys(props)) {
        if (UNSAFE_KEYS.has(key)) {
          throw new AlephaError(
            `Unsafe schema key "${key}" detected. This key is blocked to prevent prototype pollution.`,
          );
        }
        // Depth increases for object properties
        this.validateSchemaKeys(props[key], depth + 1, visited);
      }
    } else if (t.schema.isArray(schema)) {
      const arrSchema = schema as TArray;
      // Depth increases for array items
      this.validateSchemaKeys(arrSchema.items, depth + 1, visited);
    } else if (t.schema.isUnion(schema) || t.schema.isOptional(schema)) {
      // Optional/union wrappers don't increase depth - they're type modifiers
      this.validateSchemaKeys(this.unwrap(schema), depth, visited);
    }
  }

  /**
   * Validate array length.
   */
  protected validateArrayLength(arr: unknown[]): void {
    if (arr.length > this.maxArrayLength) {
      throw new AlephaError(
        `Array length (${arr.length}) exceeds maximum allowed (${this.maxArrayLength})`,
      );
    }
  }

  /**
   * Validate string length.
   */
  protected validateStringLength(str: string): void {
    if (str.length > this.maxStringLength) {
      throw new AlephaError(
        `String length (${str.length}) exceeds maximum allowed (${this.maxStringLength})`,
      );
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
      c = this.useFunctionCompilation
        ? this.compileWithFunction(schema)
        : this.compileInterpreted(schema);
      this.cache.set(schema, c);
    }
    return c as KeylessCodec<T>;
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
        const arr = self.interpretEncode(schema, value, 0);
        return JSON.stringify(arr);
      },
      decode(str: string): any {
        self.validateStringLength(str);
        const arr = JSON.parse(str);
        if (Array.isArray(arr)) {
          self.validateArrayLength(arr);
        }
        const ctx = { arr, i: 0 };
        return self.interpretDecode(schema, ctx, 0);
      },
    };
  }

  // ===========================================================================
  // Interpreter-based Encoding (Safe Mode)
  // ===========================================================================

  protected interpretEncode(schema: TSchema, value: any, depth: number): any {
    if (depth > this.maxDepth) {
      throw new AlephaError(
        `Encoding depth exceeds maximum allowed (${this.maxDepth})`,
      );
    }

    if (
      t.schema.isString(schema) ||
      t.schema.isNumber(schema) ||
      t.schema.isInteger(schema) ||
      t.schema.isBoolean(schema) ||
      this.isEnum(schema)
    ) {
      if (typeof value === "string") {
        this.validateStringLength(value);
      }
      return value;
    }

    if (t.schema.isBigInt(schema)) {
      return `${value}n`;
    }

    if (t.schema.isArray(schema)) {
      const arrSchema = schema as TArray;
      if (!Array.isArray(value)) return value;
      this.validateArrayLength(value);

      if (
        t.schema.isString(arrSchema.items) ||
        t.schema.isNumber(arrSchema.items) ||
        t.schema.isInteger(arrSchema.items) ||
        t.schema.isBoolean(arrSchema.items)
      ) {
        return value;
      }
      return value.map((e) =>
        this.interpretEncode(arrSchema.items, e, depth + 1),
      );
    }

    if (t.schema.isObject(schema)) {
      const objSchema = schema as TObject;
      const props = objSchema.properties as Record<string, TSchema>;
      const keys = Object.keys(props);
      const req = new Set((objSchema.required as string[]) || []);

      const result: any[] = [];
      for (const k of keys) {
        const ps = props[k];
        const isOpt = !req.has(k) || t.schema.isOptional(ps);
        const isNullable = this.isNullable(ps);
        const inner = this.unwrap(ps);
        const v = value[k];

        if (isOpt) {
          result.push(
            v !== undefined ? this.interpretEncode(inner, v, depth + 1) : null,
          );
        } else if (isNullable) {
          result.push(
            v !== null ? this.interpretEncode(inner, v, depth + 1) : null,
          );
        } else {
          result.push(this.interpretEncode(inner, v, depth + 1));
        }
      }
      return result;
    }

    if (t.schema.isOptional(schema) || t.schema.isUnion(schema)) {
      const inner = this.unwrap(schema);
      if (this.isNullable(schema)) {
        return value !== null
          ? this.interpretEncode(inner, value, depth + 1)
          : null;
      }
      return value !== undefined
        ? this.interpretEncode(inner, value, depth + 1)
        : null;
    }

    return value;
  }

  // ===========================================================================
  // Interpreter-based Decoding (Safe Mode)
  // ===========================================================================

  protected interpretDecode(
    schema: TSchema,
    ctx: { arr: any[]; i: number },
    depth: number,
  ): any {
    if (depth > this.maxDepth) {
      throw new AlephaError(
        `Decoding depth exceeds maximum allowed (${this.maxDepth})`,
      );
    }

    if (
      t.schema.isString(schema) ||
      t.schema.isNumber(schema) ||
      t.schema.isInteger(schema) ||
      t.schema.isBoolean(schema) ||
      this.isEnum(schema)
    ) {
      const val = ctx.arr[ctx.i++];
      if (typeof val === "string") {
        this.validateStringLength(val);
      }
      return val;
    }

    if (t.schema.isBigInt(schema)) {
      const val = ctx.arr[ctx.i++];
      return BigInt(val.slice(0, -1));
    }

    if (t.schema.isArray(schema)) {
      const arrSchema = schema as TArray;
      const arr = ctx.arr[ctx.i++];
      if (!Array.isArray(arr)) return arr;
      this.validateArrayLength(arr);

      if (t.schema.isObject(arrSchema.items)) {
        return arr.map((e) =>
          this.interpretDecodeFromValue(arrSchema.items, e, depth + 1),
        );
      }
      return arr;
    }

    if (t.schema.isObject(schema)) {
      const objSchema = schema as TObject;
      const props = objSchema.properties as Record<string, TSchema>;
      const keys = Object.keys(props);
      const req = new Set((objSchema.required as string[]) || []);

      const result: Record<string, any> = Object.create(null); // Prototype pollution safe

      for (const k of keys) {
        const ps = props[k];
        const isOpt = !req.has(k) || t.schema.isOptional(ps);
        const isNullable = this.isNullable(ps);
        const inner = this.unwrap(ps);
        const val = ctx.arr[ctx.i++];

        if (isOpt) {
          if (val !== null) {
            result[k] = this.interpretDecodeFromValue(inner, val, depth + 1);
          }
        } else if (isNullable) {
          result[k] =
            val === null
              ? null
              : this.interpretDecodeFromValue(inner, val, depth + 1);
        } else {
          result[k] = this.interpretDecodeFromValue(inner, val, depth + 1);
        }
      }

      return result;
    }

    if (t.schema.isOptional(schema) || t.schema.isUnion(schema)) {
      const inner = this.unwrap(schema);
      const val = ctx.arr[ctx.i++];
      const nullVal = this.isNullable(schema) ? null : undefined;

      if (val === null) {
        return nullVal;
      }

      // For complex types, we need to create a temporary context
      if (t.schema.isObject(inner) || t.schema.isArray(inner)) {
        return this.interpretDecodeFromValue(inner, val, depth + 1);
      }

      return val;
    }

    return ctx.arr[ctx.i++];
  }

  protected interpretDecodeFromValue(
    schema: TSchema,
    value: any,
    depth: number,
  ): any {
    if (depth > this.maxDepth) {
      throw new AlephaError(
        `Decoding depth exceeds maximum allowed (${this.maxDepth})`,
      );
    }

    if (
      t.schema.isString(schema) ||
      t.schema.isNumber(schema) ||
      t.schema.isInteger(schema) ||
      t.schema.isBoolean(schema) ||
      this.isEnum(schema)
    ) {
      if (typeof value === "string") {
        this.validateStringLength(value);
      }
      return value;
    }

    if (t.schema.isBigInt(schema)) {
      return BigInt(value.slice(0, -1));
    }

    if (t.schema.isArray(schema)) {
      if (!Array.isArray(value)) return value;
      this.validateArrayLength(value);

      const arrSchema = schema as TArray;
      // Transform array items if they're objects
      if (t.schema.isObject(arrSchema.items)) {
        return value.map((e) =>
          this.interpretDecodeFromValue(arrSchema.items, e, depth + 1),
        );
      }
      return value;
    }

    if (t.schema.isObject(schema)) {
      const objSchema = schema as TObject;
      const props = objSchema.properties as Record<string, TSchema>;
      const keys = Object.keys(props);

      const result: Record<string, any> = Object.create(null); // Prototype pollution safe

      for (let idx = 0; idx < keys.length; idx++) {
        const k = keys[idx];
        const inner = this.unwrap(props[k]);
        const v = value[idx];

        if (t.schema.isObject(inner)) {
          result[k] = this.interpretDecodeFromValue(inner, v, depth + 1);
        } else if (t.schema.isBigInt(inner)) {
          result[k] = BigInt(v.slice(0, -1));
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
    if (
      t.schema.isString(schema) ||
      t.schema.isNumber(schema) ||
      t.schema.isInteger(schema) ||
      t.schema.isBoolean(schema) ||
      this.isEnum(schema)
    ) {
      return ve;
    }

    if (t.schema.isBigInt(schema)) {
      return `${ve}+'n'`;
    }

    if (t.schema.isArray(schema)) {
      const arrSchema = schema as TArray;
      const itemEnc = this.genEnc(arrSchema.items, "e");
      if (
        t.schema.isString(arrSchema.items) ||
        t.schema.isNumber(arrSchema.items) ||
        t.schema.isInteger(arrSchema.items) ||
        t.schema.isBoolean(arrSchema.items)
      ) {
        return ve;
      }
      return `${ve}.map(e=>${itemEnc})`;
    }

    if (t.schema.isObject(schema)) {
      const objSchema = schema as TObject;
      const props = objSchema.properties as Record<string, TSchema>;
      const keys = Object.keys(props);
      const req = new Set((objSchema.required as string[]) || []);

      const parts: string[] = [];
      for (const k of keys) {
        const ps = props[k];
        const isOpt = !req.has(k) || t.schema.isOptional(ps);
        const isNullable = this.isNullable(ps);
        const inner = this.unwrap(ps);
        const innerEnc = this.genEnc(inner, `${ve}.${k}`);

        if (isOpt) {
          parts.push(`${ve}.${k}!==undefined?${innerEnc}:null`);
        } else if (isNullable) {
          parts.push(`${ve}.${k}!==null?${innerEnc}:null`);
        } else {
          parts.push(innerEnc);
        }
      }

      return `[${parts.join(",")}]`;
    }

    if (t.schema.isOptional(schema) || t.schema.isUnion(schema)) {
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

    if (
      t.schema.isString(schema) ||
      t.schema.isNumber(schema) ||
      t.schema.isInteger(schema) ||
      t.schema.isBoolean(schema) ||
      this.isEnum(schema)
    ) {
      return { code: "", result: "a[i++]" };
    }

    if (t.schema.isBigInt(schema)) {
      return { code: "", result: "BigInt(a[i++].slice(0,-1))" };
    }

    if (t.schema.isArray(schema)) {
      const arrSchema = schema as TArray;
      // Check if array items need transformation (objects)
      if (t.schema.isObject(arrSchema.items)) {
        const itemTransform = this.genDecFromValue(arrSchema.items, "e");
        return { code: "", result: `a[i++].map(e=>${itemTransform})` };
      }
      return { code: "", result: "a[i++]" };
    }

    if (t.schema.isObject(schema)) {
      const objSchema = schema as TObject;
      const props = objSchema.properties as Record<string, TSchema>;
      const keys = Object.keys(props);
      const req = new Set((objSchema.required as string[]) || []);

      // Check if simple (all required primitives)
      let simple = true;
      for (const k of keys) {
        const ps = props[k];
        const isOpt = !req.has(k) || t.schema.isOptional(ps);
        const isNullable = this.isNullable(ps);
        const inner = this.unwrap(ps);
        if (
          isOpt ||
          isNullable ||
          t.schema.isObject(inner) ||
          t.schema.isArray(inner)
        ) {
          simple = false;
          break;
        }
      }

      if (simple) {
        const fields = keys.map((k) => `${k}:a[i++]`);
        return { code: "", result: `{${fields.join(",")}}` };
      }

      let code = `const ${v}={};`;
      for (const k of keys) {
        const ps = props[k];
        const isOpt = !req.has(k) || t.schema.isOptional(ps);
        const isNullable = this.isNullable(ps);
        const inner = this.unwrap(ps);

        if (isOpt) {
          const nested = this.genDecFromValue(inner, "t");
          code += `{const t=a[i++];if(t!==null){${v}.${k}=${nested};}}`;
        } else if (isNullable) {
          const nested = this.genDecFromValue(inner, "t");
          code += `{const t=a[i++];if(t===null){${v}.${k}=null;}else{${v}.${k}=${nested};}}`;
        } else if (t.schema.isObject(inner)) {
          const nested = this.genDecFromValue(inner, "a[i++]");
          code += `${v}.${k}=${nested};`;
        } else if (t.schema.isArray(inner)) {
          // Handle arrays - check if items need transformation
          const arrSchema = inner as TArray;
          if (t.schema.isObject(arrSchema.items)) {
            const itemTransform = this.genDecFromValue(arrSchema.items, "e");
            code += `${v}.${k}=a[i++].map(e=>${itemTransform});`;
          } else {
            code += `${v}.${k}=a[i++];`;
          }
        } else {
          code += `${v}.${k}=a[i++];`;
        }
      }

      return { code, result: v };
    }

    if (t.schema.isOptional(schema) || t.schema.isUnion(schema)) {
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
    if (
      t.schema.isString(schema) ||
      t.schema.isNumber(schema) ||
      t.schema.isInteger(schema) ||
      t.schema.isBoolean(schema) ||
      this.isEnum(schema)
    ) {
      return expr;
    }
    if (t.schema.isBigInt(schema)) {
      return `BigInt(${expr}.slice(0,-1))`;
    }
    if (t.schema.isArray(schema)) {
      return expr;
    }
    if (t.schema.isObject(schema)) {
      const objSchema = schema as TObject;
      const props = objSchema.properties as Record<string, TSchema>;
      const keys = Object.keys(props);
      const v = this.nextVar();
      const fields = keys.map((k, idx) => {
        const inner = this.unwrap(props[k]);
        const innerExpr = `${v}[${idx}]`;
        if (t.schema.isObject(inner)) {
          return `${k}:${this.genDecFromValue(inner, innerExpr)}`;
        }
        if (t.schema.isBigInt(inner)) {
          return `${k}:BigInt(${innerExpr}.slice(0,-1))`;
        }
        return `${k}:${innerExpr}`;
      });
      return `((${v}=${expr})=>({${fields.join(",")}}))()`;
    }
    return expr;
  }

  // ===========================================================================
  // Helpers
  // ===========================================================================

  protected isEnum(schema: TSchema): boolean {
    return (
      "enum" in schema &&
      Array.isArray((schema as { enum?: unknown[] }).enum) &&
      ((schema as { enum?: unknown[] }).enum?.length ?? 0) > 0
    );
  }

  protected isNullable(schema: TSchema): boolean {
    if (!t.schema.isUnion(schema)) return false;
    const unionSchema = schema as TUnion;
    return unionSchema.anyOf?.some((s: TSchema) => t.schema.isNull(s)) ?? false;
  }

  protected unwrap(schema: TSchema): TSchema {
    if ("anyOf" in schema && Array.isArray((schema as TUnion).anyOf)) {
      const unionSchema = schema as TUnion;
      return (
        unionSchema.anyOf.find((s: TSchema) => !t.schema.isNull(s)) || schema
      );
    }
    return schema;
  }

  /**
   * Reconstruct an object from a parsed array (for when input is already parsed).
   */
  protected reconstructObject(schema: TSchema, arr: any[], depth = 0): any {
    if (depth > this.maxDepth) {
      throw new AlephaError(
        `Reconstruction depth exceeds maximum allowed (${this.maxDepth})`,
      );
    }

    if (!t.schema.isObject(schema)) {
      return arr;
    }

    const objSchema = schema as TObject;
    const props = objSchema.properties as Record<string, TSchema>;
    const keys = Object.keys(props);
    const result: Record<string, any> = Object.create(null); // Prototype pollution safe
    let i = 0;

    for (const k of keys) {
      const ps = props[k];
      const isOpt = t.schema.isOptional(ps);
      const isNullable = this.isNullable(ps);
      const inner = this.unwrap(ps);
      const val = arr[i++];

      if (isOpt) {
        if (val !== null) {
          result[k] = t.schema.isObject(inner)
            ? this.reconstructObject(inner, val, depth + 1)
            : val;
        }
      } else if (isNullable) {
        result[k] =
          val === null
            ? null
            : t.schema.isObject(inner)
              ? this.reconstructObject(inner, val, depth + 1)
              : val;
      } else {
        result[k] = t.schema.isObject(inner)
          ? this.reconstructObject(inner, val, depth + 1)
          : val;
      }
    }

    return result;
  }
}
