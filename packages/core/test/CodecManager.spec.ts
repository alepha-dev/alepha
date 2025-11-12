import type { StaticDecode, TSchema } from "typebox";
import { describe, expect, it } from "vitest";
import { $inject, Alepha, CodecManager, TypeBoxError, t } from "../src";
import { JsonSchemaCodec } from "../src/providers/JsonSchemaCodec.ts";
import { SchemaCodec } from "../src/providers/SchemaCodec.ts";

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
      const jsonCodec = codecManager.get("json");

      expect(jsonCodec).toBeInstanceOf(JsonSchemaCodec);
    });
  });

  describe("codec registration", () => {
    it("should register custom codec", () => {
      class CustomCodec extends SchemaCodec {
        protected transformType(schema: TSchema): TSchema | false | void {
          return false;
        }

        public encodeToString(schema: TSchema, value: any): string {
          return `custom:${JSON.stringify(value)}`;
        }

        public encodeToBinary(schema: TSchema, value: any): Uint8Array {
          const str = this.encodeToString(schema, value);
          return new TextEncoder().encode(str);
        }
      }

      const alepha = Alepha.create();
      const codecManager = alepha.codec;
      const customCodec = new CustomCodec();

      codecManager.register("custom", customCodec);

      const retrieved = codecManager.get("custom");
      expect(retrieved).toBe(customCodec);
    });

    it("should throw error when codec not found", () => {
      const alepha = Alepha.create();
      const codecManager = alepha.codec;

      expect(() => codecManager.get("nonexistent")).toThrow(
        'Codec "nonexistent" not found. Available codecs: json',
      );
    });

    it("should list available codecs in error message", () => {
      class MockCodec extends SchemaCodec {
        protected transformType(): false {
          return false;
        }
        public encodeToString(): string {
          return "";
        }
        public encodeToBinary(): Uint8Array {
          return new Uint8Array();
        }
      }

      const alepha = Alepha.create();
      const codecManager = alepha.codec;
      codecManager.register("mock", new MockCodec());

      expect(() => codecManager.get("missing")).toThrow(
        'Codec "missing" not found. Available codecs: json, mock',
      );
    });
  });

  describe("encoding - object format", () => {
    it("should encode to object by default", () => {
      const alepha = Alepha.create();
      const codecManager = alepha.codec;

      const schema = t.object({
        name: t.text(),
        age: t.int(),
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

      const schema = t.object({
        user: t.object({
          name: t.text(),
          address: t.object({
            city: t.text(),
            zip: t.text(),
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

      const schema = t.object({
        items: t.array(t.text()),
      });

      const result = codecManager.encode(schema, {
        items: ["a", "b", "c"],
      });

      expect(result).toEqual({ items: ["a", "b", "c"] });
    });

    it("should transform values according to schema", () => {
      const alepha = Alepha.create();
      const codecManager = alepha.codec;

      const schema = t.object({
        value: t.text(),
        flag: t.boolean(),
      });

      const result = codecManager.encode(schema, { value: "test", flag: true });

      expect(result).toEqual({ value: "test", flag: true });
    });

    it("should keep bigint string as-is", () => {
      const alepha = Alepha.create();
      const codecManager = alepha.codec;

      const schema = t.object({
        bigNum: t.bigint(),
      });

      const result = codecManager.encode(schema, { bigNum: "123456789" });

      expect(result.bigNum).toBe("123456789");
    });

    it("should handle optional fields", () => {
      const alepha = Alepha.create();
      const codecManager = alepha.codec;

      const schema = t.object({
        required: t.text(),
        optional: t.optional(t.text()),
      });

      const result = codecManager.encode(schema, { required: "value" });

      expect(result).toEqual({ required: "value" });
    });
  });

  describe("encoding - string format", () => {
    it("should encode to JSON string with 'as: string' option", () => {
      const alepha = Alepha.create();
      const codecManager = alepha.codec;

      const schema = t.object({
        name: t.text(),
        age: t.int(),
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

      const schema = t.object({
        items: t.array(
          t.object({
            id: t.int(),
            name: t.text(),
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

      const schema = t.object({
        name: t.text(),
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

      const schema = t.object({
        name: t.text(),
        count: t.int(),
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
        protected transformType(): false {
          return false;
        }

        public encodeToString(schema: TSchema, value: any): string {
          return `CUSTOM:${JSON.stringify(value)}`;
        }

        public encodeToBinary(): Uint8Array {
          return new Uint8Array();
        }
      }

      const alepha = Alepha.create();
      const codecManager = alepha.codec;
      codecManager.register("custom", new CustomCodec());

      const schema = t.object({ value: t.text() });
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

      const schema = t.object({ value: t.text() });

      expect(() =>
        codecManager.encode(schema, { value: "test" }, { encoder: "missing" }),
      ).toThrow('Codec "missing" not found');
    });
  });

  describe("decoding", () => {
    it("should decode object", () => {
      const alepha = Alepha.create();
      const codecManager = alepha.codec;

      const schema = t.object({
        name: t.text(),
        age: t.int(),
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

      const schema = t.object({
        name: t.text(),
        age: t.int(),
      });

      const result = codecManager.decode(schema, '{"name":"John","age":30}');

      expect(result).toEqual({ name: "John", age: 30 });
    });

    it("should decode Uint8Array", () => {
      const alepha = Alepha.create();
      const codecManager = alepha.codec;

      const schema = t.object({
        name: t.text(),
      });

      const binary = new TextEncoder().encode('{"name":"John"}');
      const result = codecManager.decode(schema, binary);

      expect(result).toEqual({ name: "John" });
    });

    it("should decode numbers correctly", () => {
      const alepha = Alepha.create();
      const codecManager = alepha.codec;

      const schema = t.object({
        count: t.int(),
        price: t.number(),
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

      const schema = t.object({
        bigNum: t.bigint(),
      });

      const result = codecManager.decode(schema, { bigNum: "123456789" });

      expect(result.bigNum).toBe("123456789");
    });

    it("should apply default values", () => {
      const alepha = Alepha.create();
      const codecManager = alepha.codec;

      const schema = t.object({
        name: t.text(),
        role: t.text({ default: "user" }),
      });

      const result = codecManager.decode(schema, { name: "John" });

      expect(result).toEqual({ name: "John", role: "user" });
    });

    it("should trim strings when trim option is set", () => {
      const alepha = Alepha.create();
      const codecManager = alepha.codec;

      const schema = t.object({
        name: t.text({ trim: true }),
      });

      const result = codecManager.decode(schema, { name: "  John  " });

      expect(result.name).toBe("John");
    });

    it("should convert null to undefined for non-nullable fields", () => {
      const alepha = Alepha.create();
      const codecManager = alepha.codec;

      const schema = t.object({
        required: t.text(),
        optional: t.optional(t.text()),
      });

      const result = codecManager.decode(schema, {
        required: "value",
        optional: null,
      });

      expect(result).toEqual({ required: "value" });
    });

    it("should validate and throw error on invalid data", () => {
      const alepha = Alepha.create();
      const codecManager = alepha.codec;

      const schema = t.object({
        age: t.int(),
      });

      expect(() =>
        codecManager.decode(schema, { age: "not a number" }),
      ).toThrow(TypeBoxError);
    });

    it("should decode arrays", () => {
      const alepha = Alepha.create();
      const codecManager = alepha.codec;

      const schema = t.object({
        items: t.array(
          t.object({
            id: t.int(),
            name: t.text(),
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
        protected transformType(): false {
          return false;
        }

        public encodeToString(): string {
          return "";
        }

        public encodeToBinary(): Uint8Array {
          return new Uint8Array();
        }

        public decode<T extends TSchema>(
          schema: T,
          value: any,
        ): StaticDecode<T> {
          // Custom decoding logic: prefix all strings with "DECODED:"
          if (typeof value === "object" && value !== null) {
            const result: any = {};
            for (const key in value) {
              if (typeof value[key] === "string") {
                result[key] = `DECODED:${value[key]}`;
              } else {
                result[key] = value[key];
              }
            }
            return super.decode(schema, result);
          }
          return super.decode(schema, value);
        }
      }

      const alepha = Alepha.create();
      const codecManager = alepha.codec;
      codecManager.register("custom", new CustomCodec());

      const schema = t.object({ value: t.text() });
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

      const schema = t.object({
        user: t.object({
          id: t.int(),
          name: t.text(),
          email: t.text(),
          active: t.boolean(),
        }),
        tags: t.array(t.text()),
        count: t.bigint(),
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

      const schema = t.object({
        data: t.text(),
        value: t.int(),
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
        protected transformType(): false {
          return false;
        }
        public encodeToString(): string {
          return "custom";
        }
        public encodeToBinary(): Uint8Array {
          return new Uint8Array();
        }
      }

      class ConfigService {
        codec = $inject(CodecManager);

        constructor() {
          this.codec.register("custom", new CustomCodec());
        }
      }

      const alepha = Alepha.create();
      alepha.inject(ConfigService);

      const codecManager = alepha.codec;
      const customCodec = codecManager.get("custom");

      expect(customCodec).toBeInstanceOf(CustomCodec);
    });
  });

  describe("JsonSchemaCodec specifics", () => {
    it("should handle null values correctly", () => {
      const alepha = Alepha.create();
      const codecManager = alepha.codec;

      const schema = t.object({
        nullable: t.nullable(t.text()),
        optional: t.optional(t.text()),
      });

      const result = codecManager.decode(schema, {
        nullable: null,
        optional: null,
      });

      expect(result.nullable).toBeNull();
      expect(result.optional).toBeUndefined();
    });

    it("should handle array preprocessing", () => {
      const alepha = Alepha.create();
      const codecManager = alepha.codec;

      const schema = t.object({
        items: t.array(t.text({ trim: true })),
      });

      const result = codecManager.decode(schema, {
        items: ["  a  ", "  b  ", "  c  "],
      });

      expect(result.items).toEqual(["a", "b", "c"]);
    });

    it("should remove undefined values from objects", () => {
      const alepha = Alepha.create();
      const codecManager = alepha.codec;

      const schema = t.object({
        a: t.text(),
        b: t.optional(t.text()),
      });

      const result = codecManager.decode(schema, {
        a: "value",
        b: undefined,
      });

      expect(result).toEqual({ a: "value" });
      expect("b" in result).toBe(false);
    });
  });

  describe("error handling", () => {
    it("should throw TypeBoxError on encoding validation failure", () => {
      const alepha = Alepha.create();
      const codecManager = alepha.codec;

      const schema = t.object({
        age: t.int({ minimum: 0, maximum: 150 }),
      });

      expect(() => codecManager.encode(schema, { age: 200 })).toThrow(
        TypeBoxError,
      );
    });

    it("should throw TypeBoxError on decoding validation failure", () => {
      const alepha = Alepha.create();
      const codecManager = alepha.codec;

      const schema = t.object({
        email: t.text({ format: "email" }),
      });

      expect(() =>
        codecManager.decode(schema, { email: "not-an-email" }),
      ).toThrow(TypeBoxError);
    });

    it("should throw error on invalid JSON string", () => {
      const alepha = Alepha.create();
      const codecManager = alepha.codec;

      const schema = t.object({ value: t.text() });

      expect(() => codecManager.decode(schema, "{ invalid json }")).toThrow();
    });
  });
});
