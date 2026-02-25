import { describe, expect, it } from "vitest";
import { Alepha } from "../Alepha.ts";
import { TypeProvider, t } from "../providers/TypeProvider.ts";

describe("TypeProvider", () => {
  describe("Primitive Types", () => {
    describe("string", () => {
      it("should decode valid strings", async () => {
        const alepha = Alepha.create();
        await alepha.start();
        const schema = t.string();

        expect(alepha.codec.decode(schema, "hello")).toBe("hello");
        expect(alepha.codec.decode(schema, "")).toBe("");
        expect(alepha.codec.decode(schema, "with spaces")).toBe("with spaces");
      });

      it("should encode strings", async () => {
        const alepha = Alepha.create();
        await alepha.start();
        const schema = t.string();

        expect(alepha.codec.encode(schema, "test")).toBe("test");
      });

      it("should handle type coercion", async () => {
        const alepha = Alepha.create();
        await alepha.start();
        const schema = t.string();

        // TypeBox's Compile with codecs may coerce some types
        expect(alepha.codec.validate(schema, 123)).toBe("123");
        expect(alepha.codec.validate(schema, true)).toBe("true");
      });
    });

    describe("number", () => {
      it("should decode valid numbers", async () => {
        const alepha = Alepha.create();
        await alepha.start();
        const schema = t.number();

        expect(alepha.codec.decode(schema, 123)).toBe(123);
        expect(alepha.codec.decode(schema, 0)).toBe(0);
        expect(alepha.codec.decode(schema, -456.789)).toBe(-456.789);
        expect(alepha.codec.decode(schema, Math.PI)).toBe(Math.PI);
      });

      it("should encode numbers", async () => {
        const alepha = Alepha.create();
        await alepha.start();
        const schema = t.number();

        expect(alepha.codec.encode(schema, 42)).toBe(42);
      });

      it("should handle type coercion", async () => {
        const alepha = Alepha.create();
        await alepha.start();
        const schema = t.number();

        // TypeBox's Compile with codecs may coerce some types
        expect(alepha.codec.validate(schema, "123")).toBe(123);
        expect(alepha.codec.validate(schema, true)).toBe(1);
        expect(alepha.codec.validate(schema, false)).toBe(0);
      });

      it("should validate constraints", async () => {
        const alepha = Alepha.create();
        await alepha.start();
        const schema = t.number({ minimum: 0, maximum: 100 });

        expect(alepha.codec.validate(schema, 0)).toBe(0);
        expect(alepha.codec.validate(schema, 50)).toBe(50);
        expect(alepha.codec.validate(schema, 100)).toBe(100);

        expect(() => alepha.codec.validate(schema, -1)).toThrow();
        expect(() => alepha.codec.validate(schema, 101)).toThrow();
      });
    });

    describe("boolean", () => {
      it("should decode valid booleans", async () => {
        const alepha = Alepha.create();
        await alepha.start();
        const schema = t.boolean();

        expect(alepha.codec.decode(schema, true)).toBe(true);
        expect(alepha.codec.decode(schema, false)).toBe(false);
      });

      it("should encode booleans", async () => {
        const alepha = Alepha.create();
        await alepha.start();
        const schema = t.boolean();

        expect(alepha.codec.encode(schema, true)).toBe(true);
        expect(alepha.codec.encode(schema, false)).toBe(false);
      });

      it("should handle type coercion", async () => {
        const alepha = Alepha.create();
        await alepha.start();
        const schema = t.boolean();

        // TypeBox's Compile with codecs may coerce some types
        expect(alepha.codec.validate(schema, "true")).toBe(true);
        expect(alepha.codec.validate(schema, "false")).toBe(false);
        expect(alepha.codec.validate(schema, 1)).toBe(true);
        expect(alepha.codec.validate(schema, 0)).toBe(false);
      });
    });

    describe("null", () => {
      it("should decode null", async () => {
        const alepha = Alepha.create();
        await alepha.start();
        const schema = t.null();

        expect(alepha.codec.decode(schema, null)).toBe(null);
      });
    });

    describe("undefined", () => {
      it("should decode undefined", async () => {
        const alepha = Alepha.create();
        await alepha.start();
        const schema = t.undefined();

        expect(alepha.codec.decode(schema, undefined)).toBe(undefined);
      });
    });

    describe("void", () => {
      it("should decode void as undefined", async () => {
        const alepha = Alepha.create();
        await alepha.start();
        const schema = t.void();

        expect(alepha.codec.decode(schema, undefined)).toBe(undefined);
      });
    });

    describe("any", () => {
      it("should accept any value", async () => {
        const alepha = Alepha.create();
        await alepha.start();
        const schema = t.any();

        expect(alepha.codec.decode(schema, "string")).toBe("string");
        expect(alepha.codec.decode(schema, 123)).toBe(123);
        expect(alepha.codec.decode(schema, true)).toBe(true);
        expect(alepha.codec.decode(schema, null)).toBe(undefined);
        expect(alepha.codec.decode(schema, undefined)).toBe(undefined);
        expect(alepha.codec.decode(schema, { key: "value" })).toEqual({
          key: "value",
        });
        expect(alepha.codec.decode(schema, [1, 2, 3])).toEqual([1, 2, 3]);
      });
    });
  });

  describe("Text Types", () => {
    describe("text with default size (regular)", () => {
      it("should accept text within 255 chars", async () => {
        const alepha = Alepha.create();
        await alepha.start();
        const schema = t.text();

        const validText = "a".repeat(255);
        expect(alepha.codec.decode(schema, validText)).toBe(validText);
      });

      it("should trim whitespace by default", async () => {
        const alepha = Alepha.create();
        await alepha.start();
        const schema = t.text();

        expect(alepha.codec.decode(schema, "  hello  ")).toBe("hello");
      });

      it("should reject text over 255 chars", async () => {
        const alepha = Alepha.create();
        await alepha.start();
        const schema = t.text();

        const tooLong = "a".repeat(256);
        expect(() => alepha.codec.validate(schema, tooLong)).toThrow();
      });

      it("should encode text", async () => {
        const alepha = Alepha.create();
        await alepha.start();
        const schema = t.text();

        expect(alepha.codec.encode(schema, "test")).toBe("test");
      });
    });

    describe("text with different sizes", () => {
      it("should validate short text (64 chars max)", async () => {
        const alepha = Alepha.create();
        await alepha.start();
        const shortSchema = t.text({ size: "short" });

        expect(alepha.codec.validate(shortSchema, "a".repeat(64))).toBe(
          "a".repeat(64),
        );
        expect(() =>
          alepha.codec.validate(shortSchema, "a".repeat(65)),
        ).toThrow();
      });

      it("should validate regular text (255 chars max)", async () => {
        const alepha = Alepha.create();
        await alepha.start();
        const regularSchema = t.text({ size: "regular" });

        expect(alepha.codec.validate(regularSchema, "a".repeat(255))).toBe(
          "a".repeat(255),
        );
        expect(() =>
          alepha.codec.validate(regularSchema, "a".repeat(256)),
        ).toThrow();
      });

      it("should validate long text (1024 chars max)", async () => {
        const alepha = Alepha.create();
        await alepha.start();
        const longSchema = t.text({ size: "long" });

        expect(alepha.codec.validate(longSchema, "a".repeat(1024))).toBe(
          "a".repeat(1024),
        );
        expect(() =>
          alepha.codec.validate(longSchema, "a".repeat(1025)),
        ).toThrow();
      });

      it("should validate rich text (65535 chars max)", async () => {
        const alepha = Alepha.create();
        await alepha.start();
        const richSchema = t.text({ size: "rich" });

        expect(alepha.codec.validate(richSchema, "a".repeat(1000))).toBe(
          "a".repeat(1000),
        );
        expect(alepha.codec.validate(richSchema, "a".repeat(65535))).toBe(
          "a".repeat(65535),
        );
        expect(() =>
          alepha.codec.validate(richSchema, "a".repeat(65536)),
        ).toThrow();
      });
    });

    describe("text helper methods", () => {
      it("should validate shortText (64 chars)", async () => {
        const alepha = Alepha.create();
        await alepha.start();
        const shortSchema = t.shortText();

        expect(alepha.codec.validate(shortSchema, "a".repeat(64))).toBe(
          "a".repeat(64),
        );
        expect(() =>
          alepha.codec.validate(shortSchema, "a".repeat(65)),
        ).toThrow();
      });

      it("should validate longText (1024 chars)", async () => {
        const alepha = Alepha.create();
        await alepha.start();
        const longSchema = t.longText();

        expect(alepha.codec.validate(longSchema, "a".repeat(1024))).toBe(
          "a".repeat(1024),
        );
        expect(() =>
          alepha.codec.validate(longSchema, "a".repeat(1025)),
        ).toThrow();
      });

      it("should validate richText (65535 chars)", async () => {
        const alepha = Alepha.create();
        await alepha.start();
        const richSchema = t.richText();

        expect(alepha.codec.decode(richSchema, "a".repeat(1000))).toBe(
          "a".repeat(1000),
        );
      });
    });

    describe("text trimming option", () => {
      it("should trim when enabled", async () => {
        const alepha = Alepha.create();
        await alepha.start();
        const trimSchema = t.text({ trim: true });

        expect(alepha.codec.decode(trimSchema, "  hello  ")).toBe("hello");
        expect(alepha.codec.decode(trimSchema, "\n\ttest\n\t")).toBe("test");
      });

      it("should not trim when disabled", async () => {
        const alepha = Alepha.create();
        await alepha.start();
        const noTrimSchema = t.text({ trim: false });

        expect(alepha.codec.decode(noTrimSchema, "  hello  ")).toBe(
          "  hello  ",
        );
      });
    });

    describe("text lowercase option", () => {
      it("should lowercase with t.text when enabled", async () => {
        const alepha = Alepha.create();
        await alepha.start();
        const schema = t.text({ lowercase: true });

        expect(alepha.codec.decode(schema, "HELLO")).toBe("hello");
        expect(alepha.codec.decode(schema, "Hello World")).toBe("hello world");
        expect(alepha.codec.decode(schema, "MixedCase123")).toBe(
          "mixedcase123",
        );
      });

      it("should lowercase with t.enum when enabled", async () => {
        const alepha = Alepha.create();
        await alepha.start();
        const schema = t.enum(["active", "inactive", "pending"], {
          lowercase: true,
        });

        expect(alepha.codec.decode(schema, "ACTIVE")).toBe("active");
        expect(alepha.codec.decode(schema, "Active")).toBe("active");
        expect(alepha.codec.validate(schema, "INACTIVE")).toBe("inactive");
      });

      it("should combine trim and lowercase with t.text", async () => {
        const alepha = Alepha.create();
        await alepha.start();
        const schema = t.text({ trim: true, lowercase: true });

        expect(alepha.codec.decode(schema, "  HELLO  ")).toBe("hello");
        expect(alepha.codec.decode(schema, "\n\tTEST\n\t")).toBe("test");
      });

      it("should not lowercase when not enabled", async () => {
        const alepha = Alepha.create();
        await alepha.start();
        const schema = t.text();

        expect(alepha.codec.decode(schema, "HELLO")).toBe("HELLO");
        expect(alepha.codec.decode(schema, "MixedCase")).toBe("MixedCase");
      });
    });

    describe("text pattern option (regex)", () => {
      it("should accept values matching the pattern", async () => {
        const alepha = Alepha.create();
        await alepha.start();
        const schema = t.text({ pattern: "^[A-Z]{3}$" });

        expect(alepha.codec.decode(schema, "ABC")).toBe("ABC");
        expect(alepha.codec.decode(schema, "XYZ")).toBe("XYZ");
      });

      it("should reject values not matching the pattern", async () => {
        const alepha = Alepha.create();
        await alepha.start();
        const schema = t.text({ pattern: "^[A-Z]{3}$" });

        expect(() => alepha.codec.validate(schema, "abc")).toThrow();
        expect(() => alepha.codec.validate(schema, "ABCD")).toThrow();
        expect(() => alepha.codec.validate(schema, "AB")).toThrow();
        expect(() => alepha.codec.validate(schema, "123")).toThrow();
      });

      it("should work with alphanumeric pattern", async () => {
        const alepha = Alepha.create();
        await alepha.start();
        const schema = t.text({ pattern: "^[a-zA-Z0-9]+$" });

        expect(alepha.codec.decode(schema, "Hello123")).toBe("Hello123");
        expect(alepha.codec.decode(schema, "test")).toBe("test");
        expect(alepha.codec.decode(schema, "123")).toBe("123");

        expect(() => alepha.codec.validate(schema, "hello world")).toThrow();
        expect(() => alepha.codec.validate(schema, "hello@test")).toThrow();
      });

      it("should work with slug pattern", async () => {
        const alepha = Alepha.create();
        await alepha.start();
        const schema = t.text({ pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$" });

        expect(alepha.codec.decode(schema, "hello-world")).toBe("hello-world");
        expect(alepha.codec.decode(schema, "my-blog-post")).toBe(
          "my-blog-post",
        );
        expect(alepha.codec.decode(schema, "test")).toBe("test");

        expect(() => alepha.codec.validate(schema, "Hello-World")).toThrow();
        expect(() => alepha.codec.validate(schema, "hello_world")).toThrow();
        expect(() => alepha.codec.validate(schema, "-hello")).toThrow();
      });

      it("should combine pattern with maxLength", async () => {
        const alepha = Alepha.create();
        await alepha.start();
        const schema = t.text({ pattern: "^[A-Z]+$", maxLength: 5 });

        expect(alepha.codec.decode(schema, "HELLO")).toBe("HELLO");
        expect(alepha.codec.decode(schema, "AB")).toBe("AB");

        expect(() => alepha.codec.validate(schema, "TOOLONG")).toThrow();
        expect(() => alepha.codec.validate(schema, "hello")).toThrow();
      });

      it("should trim before pattern validation", async () => {
        const alepha = Alepha.create();
        await alepha.start();
        const schema = t.text({ pattern: "^[A-Z]+$", trim: true });

        expect(alepha.codec.decode(schema, "  HELLO  ")).toBe("HELLO");
      });
    });
  });

  describe("Integer Types", () => {
    describe("int (32-bit integer)", () => {
      it("should decode valid 32-bit integers", async () => {
        const alepha = Alepha.create();
        await alepha.start();
        const schema = t.integer();

        expect(alepha.codec.decode(schema, 0)).toBe(0);
        expect(alepha.codec.decode(schema, 123456)).toBe(123456);
        expect(alepha.codec.decode(schema, -123456)).toBe(-123456);
        expect(alepha.codec.decode(schema, 2147483647)).toBe(2147483647);
        expect(alepha.codec.decode(schema, -2147483647)).toBe(-2147483647);
      });

      it("should reject non-integers", async () => {
        const alepha = Alepha.create();
        await alepha.start();
        const schema = t.integer();

        expect(alepha.codec.decode(schema, 3.14)).toBe(3);
      });

      it("should reject values outside 32-bit range", async () => {
        const alepha = Alepha.create();
        await alepha.start();
        const schema = t.int32();

        expect(() => alepha.codec.validate(schema, 2147483648)).toThrow();
        expect(() => alepha.codec.validate(schema, -2147483648)).toThrow();
      });
    });

    describe("integer alias", () => {
      it("should work as alias for int", async () => {
        const alepha = Alepha.create();
        await alepha.start();
        const schema = t.int32();

        expect(alepha.codec.decode(schema, 42)).toBe(42);
        expect(alepha.codec.decode(schema, 3.14)).toBe(3);
      });
    });

    describe("int64", () => {
      it("should decode valid safe integers", async () => {
        const alepha = Alepha.create();
        await alepha.start();
        const schema = t.int64();

        expect(alepha.codec.decode(schema, 0)).toBe(0);
        expect(alepha.codec.decode(schema, 9007199254740991)).toBe(
          9007199254740991,
        );
        expect(alepha.codec.decode(schema, -9007199254740991)).toBe(
          -9007199254740991,
        );
      });

      it("should reject non-integers", async () => {
        const alepha = Alepha.create();
        await alepha.start();
        const schema = t.int64();

        expect(() => alepha.codec.validate(schema, 3.14)).toThrow();
      });

      it("should reject values outside safe integer range", async () => {
        const alepha = Alepha.create();
        await alepha.start();
        const schema = t.int64();

        expect(() => alepha.codec.validate(schema, 9007199254740992)).toThrow();
        expect(() =>
          alepha.codec.validate(schema, -9007199254740992),
        ).toThrow();
      });
    });
  });

  // Codec Types tests removed - t.bigint(), t.url(), t.binary() are now plain strings without transformation

  describe("Format Types", () => {
    describe("uuid", () => {
      it("should accept valid UUIDs", async () => {
        const alepha = Alepha.create();
        await alepha.start();
        const schema = t.uuid();

        const validUuid = "550e8400-e29b-41d4-a716-446655440000";
        expect(alepha.codec.decode(schema, validUuid)).toBe(validUuid);
      });

      it("should encode UUIDs", async () => {
        const alepha = Alepha.create();
        await alepha.start();
        const schema = t.uuid();

        const validUuid = "550e8400-e29b-41d4-a716-446655440000";
        expect(alepha.codec.encode(schema, validUuid)).toBe(validUuid);
      });

      it("should reject invalid UUIDs", async () => {
        const alepha = Alepha.create();
        await alepha.start();
        const schema = t.uuid();

        expect(() => alepha.codec.validate(schema, "not-a-uuid")).toThrow();
        expect(() =>
          alepha.codec.validate(schema, "550e8400-e29b-41d4-a716"),
        ).toThrow();
        expect(() => alepha.codec.validate(schema, "")).toThrow();
      });
    });

    describe("email", () => {
      it("should accept valid emails", async () => {
        const alepha = Alepha.create();
        await alepha.start();
        const schema = t.email();

        expect(alepha.codec.decode(schema, "user@example.com")).toBe(
          "user@example.com",
        );
        expect(
          alepha.codec.decode(schema, "test.user+tag@subdomain.example.co.uk"),
        ).toBe("test.user+tag@subdomain.example.co.uk");
      });

      it("should trim emails", async () => {
        const alepha = Alepha.create();
        await alepha.start();
        const schema = t.email();

        expect(alepha.codec.decode(schema, "  user@example.com  ")).toBe(
          "user@example.com",
        );
      });

      it("should lowercase emails", async () => {
        const alepha = Alepha.create();
        await alepha.start();
        const schema = t.email();

        expect(alepha.codec.decode(schema, "User@Example.COM")).toBe(
          "user@example.com",
        );
        expect(alepha.codec.decode(schema, "JOHN.DOE@GMAIL.COM")).toBe(
          "john.doe@gmail.com",
        );
      });

      it("should trim and lowercase emails together", async () => {
        const alepha = Alepha.create();
        await alepha.start();
        const schema = t.email();

        expect(alepha.codec.decode(schema, "  User@Example.COM  ")).toBe(
          "user@example.com",
        );
      });

      it("should reject invalid emails", async () => {
        const alepha = Alepha.create();
        await alepha.start();
        const schema = t.email();

        expect(() => alepha.codec.validate(schema, "not an email")).toThrow();
        expect(() => alepha.codec.validate(schema, "@example.com")).toThrow();
        expect(() => alepha.codec.validate(schema, "user@")).toThrow();
        expect(() => alepha.codec.validate(schema, "")).toThrow();
      });
    });

    describe("e164 phone number", () => {
      it("should accept valid E.164 phone numbers", async () => {
        const alepha = Alepha.create();
        await alepha.start();
        const schema = t.e164();

        expect(alepha.codec.decode(schema, "+1234567890")).toBe("+1234567890");
        expect(alepha.codec.decode(schema, "+12025551234")).toBe(
          "+12025551234",
        );
        expect(alepha.codec.decode(schema, "+441234567890")).toBe(
          "+441234567890",
        );
      });

      it("should reject invalid E.164 phone numbers", async () => {
        const alepha = Alepha.create();
        await alepha.start();
        const schema = t.e164();

        expect(() => alepha.codec.validate(schema, "1234567890")).toThrow(); // Missing +
        expect(() => alepha.codec.validate(schema, "+0123456789")).toThrow(); // Starts with 0
        expect(() => alepha.codec.validate(schema, "+1")).toThrow(); // Too short
        expect(() =>
          alepha.codec.validate(schema, "+12345678901234567"),
        ).toThrow(); // Too long
        expect(() => alepha.codec.validate(schema, "+1234-567-890")).toThrow(); // Contains dashes
      });
    });

    describe("bcp47 language tag", () => {
      it("should accept valid BCP 47 language tags", async () => {
        const alepha = Alepha.create();
        await alepha.start();
        const schema = t.bcp47();

        expect(alepha.codec.decode(schema, "en")).toBe("en");
        expect(alepha.codec.decode(schema, "en-US")).toBe("en-US");
        expect(alepha.codec.decode(schema, "fr")).toBe("fr");
        expect(alepha.codec.decode(schema, "fr-CA")).toBe("fr-CA");
        expect(alepha.codec.decode(schema, "pt-BR")).toBe("pt-BR");
      });

      it("should reject invalid BCP 47 tags", async () => {
        const alepha = Alepha.create();
        await alepha.start();
        const schema = t.bcp47();

        expect(() => alepha.codec.validate(schema, "EN")).toThrow(); // Uppercase language
        expect(() => alepha.codec.validate(schema, "en-us")).toThrow(); // Lowercase region
        expect(() => alepha.codec.validate(schema, "e")).toThrow(); // Too short
        expect(() => alepha.codec.validate(schema, "english")).toThrow(); // Too long
        expect(() => alepha.codec.validate(schema, "en-US-variant")).toThrow(); // Too many parts
      });
    });

    describe("constantCase", () => {
      it("should accept valid constantCase strings", async () => {
        const alepha = Alepha.create();
        await alepha.start();
        const schema = t.constantCase();

        expect(alepha.codec.decode(schema, "HELLO")).toBe("HELLO");
        expect(alepha.codec.decode(schema, "HELLO_WORLD")).toBe("HELLO_WORLD");
        expect(alepha.codec.decode(schema, "TEST-VALUE")).toBe("TEST-VALUE");
        expect(alepha.codec.decode(schema, "A_B_C_D")).toBe("A_B_C_D");
      });

      it("should reject invalid constantCase", async () => {
        const alepha = Alepha.create();
        await alepha.start();
        const schema = t.constantCase();

        expect(() => alepha.codec.validate(schema, "hello")).toThrow(); // Lowercase
        expect(() => alepha.codec.validate(schema, "Hello_World")).toThrow(); // Mixed case
        expect(() => alepha.codec.validate(schema, "HELLO WORLD")).toThrow(); // Space
        expect(() => alepha.codec.validate(schema, "HELLO.WORLD")).toThrow(); // Dot
      });
    });
  });

  describe("Complex Types", () => {
    describe("object", () => {
      it("should decode valid objects", async () => {
        const alepha = Alepha.create();
        await alepha.start();
        const schema = t.object({
          name: t.text(),
          age: t.integer(),
          active: t.boolean(),
        });

        const valid = { name: "John", age: 30, active: true };
        const decoded = alepha.codec.decode(schema, valid);
        expect(decoded).toEqual(valid);
      });

      it("should encode objects", async () => {
        const alepha = Alepha.create();
        await alepha.start();
        const schema = t.object({
          name: t.text(),
          age: t.integer(),
          active: t.boolean(),
        });

        const valid = { name: "John", age: 30, active: true };
        const encoded = alepha.codec.encode(schema, valid);
        expect(encoded).toEqual(valid);
      });

      it("should reject missing required fields", async () => {
        const alepha = Alepha.create();
        await alepha.start();
        const schema = t.object({
          name: t.text(),
          age: t.integer(),
          active: t.boolean(),
        });

        expect(() =>
          alepha.codec.validate(schema, { name: "John", age: 30 }),
        ).toThrow();
      });

      it("should fix invalid field types", async () => {
        const alepha = Alepha.create();
        await alepha.start();
        const schema = t.object({
          name: t.text(),
          age: t.integer(),
          active: t.boolean(),
        });

        expect(
          alepha.codec.decode(schema, {
            name: "John",
            age: "30",
            active: true,
          }),
        ).toEqual({
          name: "John",
          age: 30,
          active: true,
        });
      });

      it("should fix additional properties by default", async () => {
        const alepha = Alepha.create();
        await alepha.start();
        const schema = t.object({
          name: t.text(),
          age: t.integer(),
          active: t.boolean(),
        });

        expect(
          alepha.codec.decode(schema, {
            name: "John",
            age: 30,
            active: true,
            extra: "field",
          }),
        ).toEqual({
          name: "John",
          age: 30,
          active: true,
        });
      });

      it("should support nested objects", async () => {
        const alepha = Alepha.create();
        await alepha.start();
        const schema = t.object({
          user: t.object({
            name: t.text(),
            email: t.email(),
          }),
          metadata: t.object({
            createdAt: t.string(),
            updatedAt: t.string(),
          }),
        });

        const valid = {
          user: {
            name: "John Doe",
            email: "john@example.com",
          },
          metadata: {
            createdAt: "2025-01-01",
            updatedAt: "2025-01-02",
          },
        };

        expect(alepha.codec.decode(schema, valid)).toEqual(valid);
      });
    });

    describe("array", () => {
      it("should decode valid arrays", async () => {
        const alepha = Alepha.create();
        await alepha.start();
        const schema = t.array(t.text());

        expect(alepha.codec.decode(schema, [])).toEqual([]);
        expect(alepha.codec.decode(schema, ["a", "b", "c"])).toEqual([
          "a",
          "b",
          "c",
        ]);
      });

      it("should enforce default max items (1000)", async () => {
        const alepha = Alepha.create();
        await alepha.start();
        const schema = t.array(t.text());

        const maxArray = new Array(1000).fill("x");
        expect(alepha.codec.decode(schema, maxArray)).toEqual(maxArray);

        const tooManyItems = new Array(1001).fill("x");
        expect(() => alepha.codec.validate(schema, tooManyItems)).toThrow();
      });

      it("should support custom maxItems", async () => {
        const alepha = Alepha.create();
        await alepha.start();
        const schema = t.array(t.integer(), { maxItems: 5 });

        expect(alepha.codec.decode(schema, [1, 2, 3, 4, 5])).toEqual([
          1, 2, 3, 4, 5,
        ]);
        expect(() =>
          alepha.codec.validate(schema, [1, 2, 3, 4, 5, 6]),
        ).toThrow();
      });

      it("should reject invalid item types", async () => {
        const alepha = Alepha.create();
        await alepha.start();
        const schema = t.array(t.text());

        expect(
          alepha.codec.decode(schema, ["valid", 123, "also valid"]),
        ).toEqual(["valid", "123", "also valid"]);
      });

      it("should reject non-array values", async () => {
        const alepha = Alepha.create();
        await alepha.start();
        const schema = t.array(t.text());

        expect(() => alepha.codec.validate(schema, "not an array")).toThrow();
      });

      it("should support array of objects", async () => {
        const alepha = Alepha.create();
        await alepha.start();
        const schema = t.array(
          t.object({
            id: t.integer(),
            name: t.text(),
          }),
        );

        const valid = [
          { id: 1, name: "Alice" },
          { id: 2, name: "Bob" },
        ];

        expect(alepha.codec.decode(schema, valid)).toEqual(valid);
      });
    });

    describe("union", () => {
      it("should accept any type in the union", async () => {
        const alepha = Alepha.create();
        await alepha.start();
        const schema = t.union([t.text(), t.integer()]);

        expect(alepha.codec.decode(schema, "hello")).toBe("hello");
        expect(alepha.codec.decode(schema, 123)).toBe(123);
      });

      it("should reject types not in the union", async () => {
        const alepha = Alepha.create();
        await alepha.start();
        const schema = t.union([t.text(), t.integer()]);

        expect(() => alepha.codec.validate(schema, {})).toThrow();
      });

      it("should support union of object types", async () => {
        const alepha = Alepha.create();
        await alepha.start();
        const schema = t.union([
          t.object({ type: t.const("A"), value: t.text() }),
          t.object({ type: t.const("B"), count: t.integer() }),
        ]);

        expect(
          alepha.codec.decode(schema, { type: "A", value: "test" }),
        ).toEqual({
          type: "A",
          value: "test",
        });
        expect(alepha.codec.decode(schema, { type: "B", count: 42 })).toEqual({
          type: "B",
          count: 42,
        });
      });
    });

    describe("record", () => {
      it("should decode valid records", async () => {
        const alepha = Alepha.create();
        await alepha.start();
        const schema = t.record(t.text(), t.integer());

        const valid = { a: 1, b: 2, c: 3 };
        expect(alepha.codec.decode(schema, valid)).toEqual(valid);
      });

      it("should accept empty records", async () => {
        const alepha = Alepha.create();
        await alepha.start();
        const schema = t.record(t.text(), t.integer());

        expect(alepha.codec.decode(schema, {})).toEqual({});
      });

      it("should reject invalid value types", async () => {
        const alepha = Alepha.create();
        await alepha.start();
        const schema = t.record(t.text(), t.integer());

        expect(() =>
          alepha.codec.validate(schema, { a: "not a number" }),
        ).toThrow();
      });
    });

    describe("json", () => {
      it("should accept any JSON object", async () => {
        const alepha = Alepha.create();
        await alepha.start();
        const schema = t.json();

        expect(alepha.codec.decode(schema, { key: "value" })).toEqual({
          key: "value",
        });
        expect(
          alepha.codec.decode(schema, { nested: { key: "value" } }),
        ).toEqual({
          nested: { key: "value" },
        });
        expect(alepha.codec.decode(schema, {})).toEqual({});
      });
    });

    describe("tuple", () => {
      it("should decode valid tuples", async () => {
        const alepha = Alepha.create();
        await alepha.start();
        const schema = t.tuple([t.text(), t.integer(), t.boolean()]);

        expect(alepha.codec.decode(schema, ["hello", 42, true])).toEqual([
          "hello",
          42,
          true,
        ]);
      });

      it("should reject tuples with wrong length", async () => {
        const alepha = Alepha.create();
        await alepha.start();
        const schema = t.tuple([
          t.text(),
          t.integer(),
          t.object({
            flag: t.boolean(),
          }),
        ]);

        expect(() => alepha.codec.validate(schema, ["hello", 42])).toThrow();
        expect(
          alepha.codec.decode(schema, ["hello", 42, { flag: true }, "extra"]),
        ).toEqual(["hello", 42, { flag: true }]);
      });

      it("should reject tuples with wrong types", async () => {
        const alepha = Alepha.create();
        await alepha.start();
        const schema = t.tuple([t.text(), t.integer(), t.boolean()]);

        expect(() =>
          alepha.codec.validate(schema, ["hello", "not a number", true]),
        ).toThrow();
      });
    });
  });

  describe("Modifier Types", () => {
    describe("optional", () => {
      it("should make fields optional", async () => {
        const alepha = Alepha.create();
        await alepha.start();
        const schema = t.object({
          required: t.text(),
          optional: t.optional(t.text()),
        });

        expect(
          alepha.codec.decode(schema, { required: "test", optional: "value" }),
        ).toEqual({
          required: "test",
          optional: "value",
        });

        expect(alepha.codec.decode(schema, { required: "test" })).toEqual({
          required: "test",
        });

        expect(
          alepha.codec.decode(schema, {
            required: "test",
            optional: undefined,
          }),
        ).toEqual({
          required: "test",
          optional: undefined,
        });
      });
    });

    describe("nullable", () => {
      it("should allow null values", async () => {
        const alepha = Alepha.create();
        await alepha.start();
        const schema = t.object({
          value: t.nullable(t.text()),
        });

        expect(alepha.codec.decode(schema, { value: "test" })).toEqual({
          value: "test",
        });
        expect(alepha.codec.decode(schema, { value: null })).toEqual({
          value: null,
        });
      });

      it("should require field to be present", async () => {
        const alepha = Alepha.create();
        await alepha.start();
        const schema = t.object({
          value: t.nullable(t.text()),
        });

        expect(() => alepha.codec.validate(schema, {})).toThrow();
      });
    });

    describe("optional nullable", () => {
      it("should allow string, null, or omitted", async () => {
        const alepha = Alepha.create();
        await alepha.start();
        const schema = t.object({
          value: t.optional(t.nullable(t.text())),
        });

        expect(alepha.codec.decode(schema, { value: "test" })).toEqual({
          value: "test",
        });
        expect(alepha.codec.decode(schema, { value: null })).toEqual({
          value: null,
        });
        expect(alepha.codec.decode(schema, {})).toEqual({});
      });
    });

    describe("partial", () => {
      it("should make all fields optional", async () => {
        const alepha = Alepha.create();
        await alepha.start();
        const baseSchema = t.object({
          name: t.text(),
          age: t.integer(),
          email: t.email(),
        });

        const partialSchema = t.partial(baseSchema);

        expect(alepha.codec.decode(partialSchema, {})).toEqual({});
        expect(alepha.codec.decode(partialSchema, { name: "John" })).toEqual({
          name: "John",
        });
        expect(
          alepha.codec.decode(partialSchema, { name: "John", age: 30 }),
        ).toEqual({
          name: "John",
          age: 30,
        });
        expect(
          alepha.codec.decode(partialSchema, {
            name: "John",
            age: 30,
            email: "john@example.com",
          }),
        ).toEqual({
          name: "John",
          age: 30,
          email: "john@example.com",
        });
      });
    });

    describe("pick", () => {
      it("should pick only specified fields", async () => {
        const alepha = Alepha.create();
        await alepha.start();
        const baseSchema = t.object({
          id: t.integer(),
          name: t.text(),
          email: t.email(),
          age: t.integer(),
        });

        const pickedSchema = t.pick(baseSchema, ["name", "email"]);

        expect(
          alepha.codec.decode(pickedSchema, {
            name: "John",
            email: "john@example.com",
          }),
        ).toEqual({
          name: "John",
          email: "john@example.com",
        });
      });

      it("should reject unpicked fields", async () => {
        const alepha = Alepha.create();
        await alepha.start();
        const baseSchema = t.object({
          id: t.integer(),
          name: t.text(),
          email: t.email(),
          age: t.integer(),
        });

        const pickedSchema = t.pick(baseSchema, ["name", "email"]);

        expect(
          alepha.codec.decode(pickedSchema, {
            name: "John",
            email: "john@example.com",
            age: 30,
          }),
        ).toEqual({
          name: "John",
          email: "john@example.com",
        });
      });

      it("should require all picked fields", async () => {
        const alepha = Alepha.create();
        await alepha.start();
        const baseSchema = t.object({
          id: t.integer(),
          name: t.text(),
          email: t.email(),
          age: t.integer(),
        });

        const pickedSchema = t.pick(baseSchema, ["name", "email"]);

        expect(() =>
          alepha.codec.validate(pickedSchema, { name: "John" }),
        ).toThrow();
      });
    });

    describe("omit", () => {
      it("should omit specified fields", async () => {
        const alepha = Alepha.create();
        await alepha.start();
        const baseSchema = t.object({
          id: t.integer(),
          name: t.text(),
          email: t.email(),
          password: t.text(),
        });

        const omittedSchema = t.omit(baseSchema, ["password"]);

        expect(
          alepha.codec.decode(omittedSchema, {
            id: 1,
            name: "John",
            email: "john@example.com",
          }),
        ).toEqual({
          id: 1,
          name: "John",
          email: "john@example.com",
        });
      });

      it("should reject omitted fields", async () => {
        const alepha = Alepha.create();
        await alepha.start();
        const baseSchema = t.object({
          id: t.integer(),
          name: t.text(),
          email: t.email(),
          password: t.text(),
        });

        const omittedSchema = t.omit(baseSchema, ["password"]);

        expect(
          alepha.codec.decode(omittedSchema, {
            id: 1,
            name: "John",
            email: "john@example.com",
            password: "secret",
          }),
        ).toEqual({
          id: 1,
          name: "John",
          email: "john@example.com",
        });
      });
    });
  });

  describe("Literal Types", () => {
    describe("enum", () => {
      it("should accept valid enum values", async () => {
        const alepha = Alepha.create();
        await alepha.start();
        const schema = t.enum(["ACTIVE", "INACTIVE", "PENDING"]);

        expect(alepha.codec.decode(schema, "ACTIVE")).toBe("ACTIVE");
        expect(alepha.codec.decode(schema, "INACTIVE")).toBe("INACTIVE");
        expect(alepha.codec.decode(schema, "PENDING")).toBe("PENDING");
      });

      it("should reject invalid enum values", async () => {
        const alepha = Alepha.create();
        await alepha.start();
        const schema = t.enum(["ACTIVE", "INACTIVE", "PENDING"]);

        expect(() => alepha.codec.validate(schema, "INVALID")).toThrow();
        expect(() => alepha.codec.validate(schema, "active")).toThrow(); // Case sensitive
        expect(() => alepha.codec.validate(schema, "")).toThrow();
      });
    });

    describe("const (literal)", () => {
      it("should accept only the literal value", async () => {
        const alepha = Alepha.create();
        await alepha.start();
        const schema = t.const("FIXED_VALUE");

        expect(alepha.codec.decode(schema, "FIXED_VALUE")).toBe("FIXED_VALUE");
      });

      it("should reject non-matching values", async () => {
        const alepha = Alepha.create();
        await alepha.start();
        const schema = t.const("FIXED_VALUE");

        expect(() => alepha.codec.validate(schema, "OTHER_VALUE")).toThrow();
        expect(() => alepha.codec.validate(schema, "")).toThrow();
      });

      it("should support number literals", async () => {
        const alepha = Alepha.create();
        await alepha.start();
        const schema = t.const(42);

        expect(alepha.codec.decode(schema, 42)).toBe(42);
        expect(() => alepha.codec.decode(schema, 43)).toThrow();
      });
    });
  });

  describe("Helper Types", () => {
    describe("valueLabel", () => {
      it("should decode valid valueLabel objects", async () => {
        const alepha = Alepha.create();
        await alepha.start();
        const schema = t.valueLabel();

        const valid = {
          value: "ACTIVE",
          label: "Active Status",
        };
        expect(alepha.codec.decode(schema, valid)).toEqual(valid);
      });

      it("should support optional description", async () => {
        const alepha = Alepha.create();
        await alepha.start();
        const schema = t.valueLabel();

        const withDesc = {
          value: "PENDING",
          label: "Pending Status",
          description: "Item is pending approval",
        };
        expect(alepha.codec.decode(schema, withDesc)).toEqual(withDesc);
      });

      it("should validate value is constantCase", async () => {
        const alepha = Alepha.create();
        await alepha.start();
        const schema = t.valueLabel();

        expect(() =>
          alepha.codec.decode(schema, {
            value: "not-constant-case",
            label: "Label",
          }),
        ).toThrow();
      });
    });
  });

  describe("File Types", () => {
    describe("file", () => {
      it("should create file schema with binary format", async () => {
        const alepha = Alepha.create();
        await alepha.start();
        const schema = t.file();

        expect(schema).toBeDefined();
        expect((schema as any).format).toBe("binary");
      });

      it("should support maxSize option", async () => {
        const alepha = Alepha.create();
        await alepha.start();
        const schema = t.file({ maxSize: 1024 * 1024 }); // 1MB

        expect(schema).toBeDefined();
        expect((schema as any).format).toBe("binary");
      });
    });

    describe("stream", () => {
      it("should create stream schema", async () => {
        const alepha = Alepha.create();
        await alepha.start();
        const schema = t.stream();

        expect(schema).toBeDefined();
        expect((schema as any).format).toBe("stream");
      });
    });
  });

  describe("Complex Scenarios", () => {
    it("should handle complex nested structures", async () => {
      const alepha = Alepha.create();
      await alepha.start();

      const schema = t.object({
        id: t.uuid(),
        user: t.object({
          name: t.shortText(),
          email: t.email(),
          age: t.optional(t.integer()),
          roles: t.array(t.enum(["ADMIN", "USER", "GUEST"])),
        }),
        metadata: t.nullable(
          t.object({
            createdAt: t.string(),
            tags: t.array(t.text()),
          }),
        ),
        settings: t.record(t.text(), t.boolean()),
      });

      const valid = {
        id: "550e8400-e29b-41d4-a716-446655440000",
        user: {
          name: "John Doe",
          email: "john@example.com",
          roles: ["ADMIN", "USER"],
        },
        metadata: {
          createdAt: "2025-01-01T00:00:00Z",
          tags: ["important", "reviewed"],
        },
        settings: {
          notifications: true,
          darkMode: false,
        },
      };

      const decoded = alepha.codec.decode(schema, valid);
      expect(decoded).toEqual(valid);

      // With null metadata
      const withNull = {
        ...valid,
        metadata: null,
      };
      expect(alepha.codec.decode(schema, withNull)).toEqual(withNull);
    });

    it("should handle encode/decode round trips", async () => {
      const alepha = Alepha.create();
      await alepha.start();

      const schema = t.object({
        text: t.text(),
        number: t.number(),
        bool: t.boolean(),
        array: t.array(t.integer()),
        nested: t.object({
          key: t.text(),
        }),
      });

      const original = {
        text: "hello",
        number: 123.45,
        bool: true,
        array: [1, 2, 3],
        nested: {
          key: "value",
        },
      };

      const encoded = alepha.codec.encode(schema, original);
      const decoded = alepha.codec.decode(schema, encoded);

      expect(decoded).toEqual(original);
    });

    it("should provide validation error context", async () => {
      const alepha = Alepha.create();
      await alepha.start();

      const schema = t.object({
        name: t.text(),
        age: t.integer(),
      });

      try {
        alepha.codec.decode(schema, { name: "John", age: "not a number" });
        expect.fail("Should have thrown");
      } catch (error: any) {
        expect(error).toBeDefined();
      }
    });
  });

  describe("TypeGuard", () => {
    it("should correctly identify string schemas", () => {
      const { schema } = t;

      expect(schema.isString(t.text())).toBe(true);
      expect(schema.isString(t.integer())).toBe(false);
    });

    it("should correctly identify number schemas", () => {
      const { schema } = t;

      expect(schema.isNumber(t.number())).toBe(true);
      expect(schema.isNumber(t.text())).toBe(false);
    });

    it("should correctly identify integer schemas", () => {
      const { schema } = t;

      expect(schema.isInteger(t.integer())).toBe(true);
      expect(schema.isInteger(t.number())).toBe(false);
    });

    it("should correctly identify boolean schemas", () => {
      const { schema } = t;

      expect(schema.isBoolean(t.boolean())).toBe(true);
      expect(schema.isBoolean(t.text())).toBe(false);
    });

    it("should correctly identify object schemas", () => {
      const { schema } = t;

      expect(schema.isObject(t.object({ key: t.text() }))).toBe(true);
      expect(schema.isObject(t.array(t.text()))).toBe(false);
    });

    it("should correctly identify array schemas", () => {
      const { schema } = t;

      expect(schema.isArray(t.array(t.text()))).toBe(true);
      expect(schema.isArray(t.text())).toBe(false);
    });

    it("should correctly identify union schemas", () => {
      const { schema } = t;

      expect(schema.isUnion(t.union([t.text(), t.integer()]))).toBe(true);
      expect(schema.isUnion(t.text())).toBe(false);
    });

    it("should correctly identify optional schemas", () => {
      const { schema } = t;

      expect(schema.isOptional(t.optional(t.text()))).toBe(true);
      expect(schema.isOptional(t.text())).toBe(false);
    });

    it("should correctly identify null schemas", () => {
      const { schema } = t;

      expect(schema.isNull(t.null())).toBe(true);
      expect(schema.isNull(t.undefined())).toBe(false);
    });

    it("should correctly identify undefined schemas", () => {
      const { schema } = t;

      expect(schema.isUndefined(t.undefined())).toBe(true);
      expect(schema.isUndefined(t.null())).toBe(false);
    });

    it("should correctly identify any schemas", () => {
      const { schema } = t;

      expect(schema.isAny(t.any())).toBe(true);
      expect(schema.isAny(t.text())).toBe(false);
    });

    it("should correctly identify record schemas", () => {
      const { schema } = t;

      expect(schema.isRecord(t.record(t.text(), t.integer()))).toBe(true);
      expect(schema.isRecord(t.object({}))).toBe(false);
    });

    it("should correctly identify tuple schemas", () => {
      const { schema } = t;

      expect(schema.isTuple(t.tuple([t.text(), t.integer()]))).toBe(true);
      expect(schema.isTuple(t.array(t.text()))).toBe(false);
    });

    it("should correctly identify void schemas", () => {
      const { schema } = t;

      expect(schema.isVoid(t.void())).toBe(true);
      expect(schema.isVoid(t.undefined())).toBe(false);
    });

    it("should correctly identify uuid schemas", () => {
      const { schema } = t;

      expect(schema.isUUID(t.uuid())).toBe(true);
      expect(schema.isUUID(t.text())).toBe(false);
    });

    it("should correctly identify bigint schemas", () => {
      const { schema } = t;

      expect(schema.isBigInt(t.bigint())).toBe(true);
      expect(schema.isBigInt(t.integer())).toBe(false);
    });

    it("should correctly identify scalar schemas", () => {
      const { schema } = t;

      expect(schema.isScalar(t.string())).toBe(true);
      expect(schema.isScalar(t.number())).toBe(true);
      expect(schema.isScalar(t.integer())).toBe(true);
      expect(schema.isScalar(t.boolean())).toBe(true);
      expect(schema.isScalar(t.object({}))).toBe(false);
      expect(schema.isScalar(t.array(t.string()))).toBe(false);
    });
  });

  describe("TypeProvider static methods", () => {
    describe("isValidBigInt", () => {
      it("should validate valid bigint strings", () => {
        expect(TypeProvider.isValidBigInt("123")).toBe(true);
        expect(TypeProvider.isValidBigInt("0")).toBe(true);
        expect(TypeProvider.isValidBigInt("-456")).toBe(true);
        expect(
          TypeProvider.isValidBigInt("123456789012345678901234567890"),
        ).toBe(true);
      });

      it("should validate integer numbers", () => {
        expect(TypeProvider.isValidBigInt(123)).toBe(true);
        expect(TypeProvider.isValidBigInt(0)).toBe(true);
        expect(TypeProvider.isValidBigInt(-456)).toBe(true);
      });

      it("should reject invalid bigint values", () => {
        expect(TypeProvider.isValidBigInt("12.34")).toBe(false);
        expect(TypeProvider.isValidBigInt("not a number")).toBe(false);
        expect(TypeProvider.isValidBigInt("")).toBe(false);
        expect(TypeProvider.isValidBigInt("  ")).toBe(false);
        expect(TypeProvider.isValidBigInt(3.14)).toBe(false);
      });
    });
  });
});
