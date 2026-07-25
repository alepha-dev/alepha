import {
  $inject,
  Alepha,
  CodecManager,
  SchemaValidationError,
  z,
} from "alepha";
import { describe, expect, it } from "vitest";
import { JsonSchemaCodec } from "../providers/JsonSchemaCodec.ts";
import { SchemaCodec } from "../providers/SchemaCodec.ts";
import type { TSchema } from "../providers/TypeProvider.ts";

describe("CodecManager", () => {
  describe("initialization", () => {
    it("should initialize with JSON codec as default", () => {
      const alepha = Alepha.create();
      const codecManager = alepha.codec;

      expect(codecManager).toBeInstanceOf(CodecManager);
      expect(codecManager.default).toBe("json");
    });

    it("should get JSON codec by default", () => {
      const alepha = Alepha.create();
      const codecManager = alepha.codec;
      const jsonCodec = codecManager.getCodec("json");

      expect(jsonCodec).toBeInstanceOf(JsonSchemaCodec);
    });
  });

  describe("codec registration", () => {
    it("should register custom codec", () => {
      class CustomCodec extends SchemaCodec {
        public encodeToString(schema: TSchema, value: any): string {
          return `custom:${JSON.stringify(value)}`;
        }

        public encodeToBinary(schema: TSchema, value: any): Uint8Array {
          const str = this.encodeToString(schema, value);
          return new TextEncoder().encode(str);
        }

        public decode<T>(schema: TSchema, value: unknown): T {
          return value as T;
        }
      }

      const alepha = Alepha.create();
      const codecManager = alepha.codec;
      const customCodec = new CustomCodec();

      codecManager.register({
        name: "custom",
        codec: customCodec,
      });

      const retrieved = codecManager.getCodec("custom");
      expect(retrieved).toBe(customCodec);
    });

    it("should throw error when codec not found", () => {
      const alepha = Alepha.create();
      const codecManager = alepha.codec;

      expect(() => codecManager.getCodec("nonexistent")).toThrow(
        'Codec "nonexistent" not found. Available codecs: json',
      );
    });

    it("should list available codecs in error message", () => {
      class MockCodec extends SchemaCodec {
        public encodeToString(): string {
          return "";
        }
        public encodeToBinary(): Uint8Array {
          return new Uint8Array();
        }
        public decode<T>(schema: TSchema, value: unknown): T {
          return value as T;
        }
      }

      const alepha = Alepha.create();
      const codecManager = alepha.codec;
      codecManager.register({
        name: "mock",
        codec: new MockCodec(),
      });

      expect(() => codecManager.getCodec("missing")).toThrow(
        'Codec "missing" not found. Available codecs: json, keyless, mock',
      );
    });
  });

  describe("encoding - object format", () => {
    it("should encode to object by default", () => {
      const alepha = Alepha.create();
      const codecManager = alepha.codec;

      const schema = z.object({
        name: z.text(),
        age: z.integer(),
      });

      const result = codecManager.encode(schema, {
        name: "John",
        age: 30,
      });

      expect(result).toEqual({ name: "John", age: 30 });
    });

    it("should encode nested objects", () => {
      const alepha = Alepha.create();
      const codecManager = alepha.codec;

      const schema = z.object({
        user: z.object({
          name: z.text(),
          address: z.object({
            city: z.text(),
            zip: z.text(),
          }),
        }),
      });

      const result = codecManager.encode(schema, {
        user: {
          name: "John",
          address: {
            city: "NYC",
            zip: "10001",
          },
        },
      });

      expect(result).toEqual({
        user: {
          name: "John",
          address: {
            city: "NYC",
            zip: "10001",
          },
        },
      });
    });

    it("should encode arrays", () => {
      const alepha = Alepha.create();
      const codecManager = alepha.codec;

      const schema = z.object({
        items: z.array(z.text()),
      });

      const result = codecManager.encode(schema, {
        items: ["a", "b", "c"],
      });

      expect(result).toEqual({ items: ["a", "b", "c"] });
    });

    it("should transform values according to schema", () => {
      const alepha = Alepha.create();
      const codecManager = alepha.codec;

      const schema = z.object({
        value: z.text(),
        flag: z.boolean(),
      });

      const result = codecManager.encode(schema, { value: "test", flag: true });

      expect(result).toEqual({ value: "test", flag: true });
    });

    it("should keep bigint string as-is", () => {
      const alepha = Alepha.create();
      const codecManager = alepha.codec;

      const schema = z.object({
        bigNum: z.bigint(),
      });

      const result = codecManager.encode(schema, { bigNum: "123456789" });

      expect(result.bigNum).toBe("123456789");
    });

    it("should handle optional fields", () => {
      const alepha = Alepha.create();
      const codecManager = alepha.codec;

      const schema = z.object({
        required: z.text(),
        optional: z.text().optional(),
      });

      const result = codecManager.encode(schema, { required: "value" });

      expect(result).toEqual({ required: "value" });
    });
  });

  describe("encoding - string format", () => {
    it("should encode to JSON string with 'as: string' option", () => {
      const alepha = Alepha.create();
      const codecManager = alepha.codec;

      const schema = z.object({
        name: z.text(),
        age: z.integer(),
      });

      const result = codecManager.encode(
        schema,
        { name: "John", age: 30 },
        { as: "string" },
      );

      expect(typeof result).toBe("string");
      expect(result).toBe('{"name":"John","age":30}');
    });

    it("should encode complex objects to JSON string", () => {
      const alepha = Alepha.create();
      const codecManager = alepha.codec;

      const schema = z.object({
        items: z.array(
          z.object({
            id: z.integer(),
            name: z.text(),
          }),
        ),
      });

      const result = codecManager.encode(
        schema,
        {
          items: [
            { id: 1, name: "Item 1" },
            { id: 2, name: "Item 2" },
          ],
        },
        { as: "string" },
      );

      expect(result).toBe(
        '{"items":[{"id":1,"name":"Item 1"},{"id":2,"name":"Item 2"}]}',
      );
    });
  });

  describe("encoding - binary format", () => {
    it("should encode to Uint8Array with 'as: binary' option", () => {
      const alepha = Alepha.create();
      const codecManager = alepha.codec;

      const schema = z.object({
        name: z.text(),
      });

      const result = codecManager.encode(
        schema,
        { name: "John" },
        { as: "binary" },
      );

      expect(result).toBeInstanceOf(Uint8Array);

      const decoded = new TextDecoder().decode(result);
      expect(decoded).toBe('{"name":"John"}');
    });

    it("should encode and decode binary roundtrip", () => {
      const alepha = Alepha.create();
      const codecManager = alepha.codec;

      const schema = z.object({
        name: z.text(),
        count: z.integer(),
      });

      const original = { name: "Test", count: 42 };
      const binary = codecManager.encode(schema, original, { as: "binary" });
      const decoded = codecManager.decode(schema, binary);

      expect(decoded).toEqual(original);
    });
  });

  describe("custom encoder option", () => {
    it("should use custom encoder when specified", () => {
      class CustomCodec extends SchemaCodec {
        public encodeToString(_schema: TSchema, value: any): string {
          return `CUSTOM:${JSON.stringify(value)}`;
        }

        public encodeToBinary(): Uint8Array {
          return new Uint8Array();
        }

        public decode<T>(_schema: TSchema, value: unknown): T {
          return value as T;
        }
      }

      const alepha = Alepha.create();
      const codecManager = alepha.codec;
      codecManager.register({ name: "custom", codec: new CustomCodec() });

      const schema = z.object({ value: z.text() });
      const result = codecManager.encode(
        schema,
        { value: "test" },
        { encoder: "custom", as: "string" },
      );

      expect(result).toBe('CUSTOM:{"value":"test"}');
    });

    it("should throw error when custom encoder not found", () => {
      const alepha = Alepha.create();
      const codecManager = alepha.codec;

      const schema = z.object({ value: z.text() });

      expect(() =>
        codecManager.encode(schema, { value: "test" }, { encoder: "missing" }),
      ).toThrow('Codec "missing" not found');
    });
  });

  describe("decoding", () => {
    it("should decode object", () => {
      const alepha = Alepha.create();
      const codecManager = alepha.codec;

      const schema = z.object({
        name: z.text(),
        age: z.integer(),
      });

      const result = codecManager.decode(schema, {
        name: "John",
        age: 30,
      });

      expect(result).toEqual({ name: "John", age: 30 });
    });

    it("should decode JSON string", () => {
      const alepha = Alepha.create();
      const codecManager = alepha.codec;

      const schema = z.object({
        name: z.text(),
        age: z.integer(),
      });

      const result = codecManager.decode(schema, '{"name":"John","age":30}');

      expect(result).toEqual({ name: "John", age: 30 });
    });

    it("should decode Uint8Array", () => {
      const alepha = Alepha.create();
      const codecManager = alepha.codec;

      const schema = z.object({
        name: z.text(),
      });

      const binary = new TextEncoder().encode('{"name":"John"}');
      const result = codecManager.decode(schema, binary);

      expect(result).toEqual({ name: "John" });
    });

    it("should decode numbers correctly", () => {
      const alepha = Alepha.create();
      const codecManager = alepha.codec;

      const schema = z.object({
        count: z.integer(),
        price: z.number(),
      });

      const result = codecManager.decode(schema, {
        count: 42,
        price: 19.99,
      });

      expect(result.count).toBe(42);
      expect(result.price).toBe(19.99);
    });

    it("should decode string to string (bigint format)", () => {
      const alepha = Alepha.create();
      const codecManager = alepha.codec;

      const schema = z.object({
        bigNum: z.bigint(),
      });

      const result = codecManager.decode(schema, { bigNum: "123456789" });

      expect(result.bigNum).toBe("123456789");
    });

    it("should apply default values during validation", () => {
      const alepha = Alepha.create();
      const codecManager = alepha.codec;

      const schema = z.object({
        name: z.text(),
        role: z.text({ default: "user" }),
      });

      const decoded = codecManager.decode(schema, { name: "John" });
      const result = codecManager.validate(schema, decoded);

      expect(result).toEqual({ name: "John", role: "user" });
    });

    it("should trim strings when trim option is set during validation", () => {
      const alepha = Alepha.create();
      const codecManager = alepha.codec;

      const schema = z.object({
        name: z.text({ trim: true }),
      });

      const decoded = codecManager.decode(schema, { name: "  John  " });
      const result = codecManager.validate(schema, decoded);

      expect(result.name).toBe("John");
    });

    it("should reject null for a non-nullable optional field (no null->undefined coercion)", () => {
      const alepha = Alepha.create();
      const codecManager = alepha.codec;

      const schema = z.object({
        required: z.text(),
        optional: z.text().optional(),
      });

      // Strict zod: an optional field accepts `undefined`, not `null`.
      expect(() =>
        codecManager.decode(schema, {
          required: "value",
          optional: null,
        }),
      ).toThrow();

      const decoded = codecManager.decode(schema, {
        required: "value",
        optional: undefined,
      });
      const result = codecManager.validate(schema, decoded);

      expect(result).toEqual({ required: "value" });
    });

    it("should validate and throw error on invalid data", () => {
      const alepha = Alepha.create();
      const codecManager = alepha.codec;

      const schema = z.object({
        age: z.integer(),
      });

      expect(() =>
        codecManager.decode(schema, { age: "not a number" }),
      ).toThrow(SchemaValidationError);
    });

    it("should decode arrays", () => {
      const alepha = Alepha.create();
      const codecManager = alepha.codec;

      const schema = z.object({
        items: z.array(
          z.object({
            id: z.integer(),
            name: z.text(),
          }),
        ),
      });

      const result = codecManager.decode(schema, {
        items: [
          { id: 1, name: "Item 1" },
          { id: 2, name: "Item 2" },
        ],
      });

      expect(result.items).toHaveLength(2);
      expect(result.items[0]).toEqual({ id: 1, name: "Item 1" });
    });

    it("should use custom decoder when specified", () => {
      class CustomCodec extends SchemaCodec {
        public encodeToString(): string {
          return "";
        }

        public encodeToBinary(): Uint8Array {
          return new Uint8Array();
        }

        public decode<T>(_schema: TSchema, value: unknown): T {
          // Custom decoding logic: prefix all strings with "DECODED:"
          if (typeof value === "object" && value !== null) {
            const result: any = {};
            const obj = value as Record<string, any>;
            for (const key in obj) {
              if (typeof obj[key] === "string") {
                result[key] = `DECODED:${obj[key]}`;
              } else {
                result[key] = obj[key];
              }
            }
            return result as T;
          }
          return value as T;
        }
      }

      const alepha = Alepha.create();
      const codecManager = alepha.codec;
      codecManager.register({ name: "custom", codec: new CustomCodec() });

      const schema = z.object({ value: z.text() });
      const result = codecManager.decode(
        schema,
        { value: "test" },
        { encoder: "custom" },
      );

      expect(result.value).toBe("DECODED:test");
    });
  });

  describe("roundtrip encoding/decoding", () => {
    it("should handle roundtrip for complex objects", () => {
      const alepha = Alepha.create();
      const codecManager = alepha.codec;

      const schema = z.object({
        user: z.object({
          id: z.integer(),
          name: z.text(),
          email: z.text(),
          active: z.boolean(),
        }),
        tags: z.array(z.text()),
        count: z.bigint(),
      });

      const original = {
        user: {
          id: 1,
          name: "John Doe",
          email: "john@example.com",
          active: true,
        },
        tags: ["typescript", "testing"],
        count: "999999999999",
      };

      // Encode to string
      const encoded = codecManager.encode(schema, original, { as: "string" });

      // Decode back
      const decoded = codecManager.decode(schema, encoded);

      expect(decoded.user.id).toBe(original.user.id);
      expect(decoded.user.name).toBe(original.user.name);
      expect(decoded.user.email).toBe(original.user.email);
      expect(decoded.user.active).toBe(original.user.active);
      expect(decoded.tags).toEqual(original.tags);
      expect(decoded.count).toBe(original.count);
    });

    it("should handle roundtrip with binary format", () => {
      const alepha = Alepha.create();
      const codecManager = alepha.codec;

      const schema = z.object({
        data: z.text(),
        value: z.integer(),
      });

      const original = { data: "test", value: 42 };

      const binary = codecManager.encode(schema, original, { as: "binary" });
      const decoded = codecManager.decode(schema, binary);

      expect(decoded).toEqual(original);
    });
  });

  describe("integration with Alepha container", () => {
    it("should inject CodecManager via $inject", () => {
      class TestService {
        codec = $inject(CodecManager);
      }

      const alepha = Alepha.create();
      const service = alepha.inject(TestService);

      expect(service.codec).toBeInstanceOf(CodecManager);
      expect(service.codec).toBe(alepha.codec);
    });

    it("should use same CodecManager instance across services", () => {
      class Service1 {
        codec = $inject(CodecManager);
      }

      class Service2 {
        codec = $inject(CodecManager);
      }

      const alepha = Alepha.create();
      const s1 = alepha.inject(Service1);
      const s2 = alepha.inject(Service2);

      expect(s1.codec).toBe(s2.codec);
    });

    it("should register custom codec in service", () => {
      class CustomCodec extends SchemaCodec {
        public encodeToString(): string {
          return "custom";
        }
        public encodeToBinary(): Uint8Array {
          return new Uint8Array();
        }
        public decode<T>(_schema: TSchema, value: unknown): T {
          return value as T;
        }
      }

      class ConfigService {
        codec = $inject(CodecManager);

        constructor() {
          this.codec.register({ name: "custom", codec: new CustomCodec() });
        }
      }

      const alepha = Alepha.create();
      alepha.inject(ConfigService);

      const codecManager = alepha.codec;
      const customCodec = codecManager.getCodec("custom");

      expect(customCodec).toBeInstanceOf(CustomCodec);
    });
  });

  describe("JsonSchemaCodec specifics", () => {
    it("should handle null values correctly during validation", () => {
      const alepha = Alepha.create();
      const codecManager = alepha.codec;

      const schema = z.object({
        nullable: z.text().nullable(),
        optional: z.text().optional(),
      });

      const decoded = codecManager.decode(schema, {
        nullable: null,
        optional: undefined,
      });
      const result = codecManager.validate(schema, decoded);

      expect(result.nullable).toBeNull();
      expect(result.optional).toBeUndefined();

      // Strict zod: `null` on the non-nullable optional field is rejected
      // (no null->undefined coercion in the validator).
      expect(() =>
        codecManager.decode(schema, { nullable: null, optional: null }),
      ).toThrow();
    });

    it("should handle array preprocessing during validation", () => {
      const alepha = Alepha.create();
      const codecManager = alepha.codec;

      const schema = z.object({
        items: z.array(z.text({ trim: true })),
      });

      const decoded = codecManager.decode(schema, {
        items: ["  a  ", "  b  ", "  c  "],
      });
      const result = codecManager.validate(schema, decoded);

      expect(result.items).toEqual(["a", "b", "c"]);
    });

    it("should keep an explicit undefined optional key present during validation", () => {
      const alepha = Alepha.create();
      const codecManager = alepha.codec;

      const schema = z.object({
        a: z.text(),
        b: z.text().optional(),
      });

      const decoded = codecManager.decode(schema, {
        a: "value",
        b: undefined,
      });
      const result = codecManager.validate(schema, decoded);

      // Strict zod: no deleteUndefined — an explicitly-undefined optional key
      // is preserved (toEqual ignores undefined props, so it still matches).
      expect(result).toEqual({ a: "value" });
      expect(result.b).toBeUndefined();
      expect("b" in result).toBe(true);
    });
  });

  describe("error handling", () => {
    it("should throw SchemaValidationError on encoding validation failure", () => {
      const alepha = Alepha.create();
      const codecManager = alepha.codec;

      const schema = z.object({
        age: z.integer().min(0).max(150),
      });

      expect(() => codecManager.encode(schema, { age: 200 })).toThrow(
        SchemaValidationError,
      );
    });

    it("should throw SchemaValidationError when validating invalid decoded data", () => {
      const alepha = Alepha.create();
      const codecManager = alepha.codec;

      // A real format-validating schema (`z.email()`); `z.text({ format })` is
      // only a metadata tag now and does not enforce the format.
      const schema = z.object({
        email: z.email(),
      });

      expect(() =>
        codecManager.decode(schema, { email: "not-an-email" }),
      ).toThrow(SchemaValidationError);
    });

    it("should throw error on invalid JSON string", () => {
      const alepha = Alepha.create();
      const codecManager = alepha.codec;

      const schema = z.object({ value: z.text() });

      expect(() => codecManager.decode(schema, "{ invalid json }")).toThrow();
    });
  });
});
