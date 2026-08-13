import { describe, expect, it } from "vitest";
import { Alepha } from "../Alepha.ts";
import { z } from "../providers/TypeProvider.ts";

describe("TypeProvider", () => {
  describe("Primitive Types", () => {
    describe("string", () => {
      it("should decode valid strings", async () => {
        const alepha = Alepha.create();
        await alepha.start();
        const schema = z.string();

        expect(alepha.codec.decode(schema, "hello")).toBe("hello");
        expect(alepha.codec.decode(schema, "")).toBe("");
        expect(alepha.codec.decode(schema, "with spaces")).toBe("with spaces");
      });

      it("should encode strings", async () => {
        const alepha = Alepha.create();
        await alepha.start();
        const schema = z.string();

        expect(alepha.codec.encode(schema, "test")).toBe("test");
      });

      it("should reject non-strings (no coercion)", async () => {
        const alepha = Alepha.create();
        await alepha.start();
        const schema = z.string();

        // Strict zod: no value coercion — non-strings are rejected.
        expect(() => alepha.codec.validate(schema, 123)).toThrow();
        expect(() => alepha.codec.validate(schema, true)).toThrow();
      });
    });

    describe("number", () => {
      it("should decode valid numbers", async () => {
        const alepha = Alepha.create();
        await alepha.start();
        const schema = z.number();

        expect(alepha.codec.decode(schema, 123)).toBe(123);
        expect(alepha.codec.decode(schema, 0)).toBe(0);
        expect(alepha.codec.decode(schema, -456.789)).toBe(-456.789);
        expect(alepha.codec.decode(schema, Math.PI)).toBe(Math.PI);
      });

      it("should encode numbers", async () => {
        const alepha = Alepha.create();
        await alepha.start();
        const schema = z.number();

        expect(alepha.codec.encode(schema, 42)).toBe(42);
      });

      it("should reject non-numbers (no coercion)", async () => {
        const alepha = Alepha.create();
        await alepha.start();
        const schema = z.number();

        // Strict zod: no value coercion — strings/booleans are rejected.
        expect(() => alepha.codec.validate(schema, "123")).toThrow();
        expect(() => alepha.codec.validate(schema, true)).toThrow();
        expect(() => alepha.codec.validate(schema, false)).toThrow();
      });

      it("should validate constraints", async () => {
        const alepha = Alepha.create();
        await alepha.start();
        const schema = z.number().min(0).max(100);

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
        const schema = z.boolean();

        expect(alepha.codec.decode(schema, true)).toBe(true);
        expect(alepha.codec.decode(schema, false)).toBe(false);
      });

      it("should encode booleans", async () => {
        const alepha = Alepha.create();
        await alepha.start();
        const schema = z.boolean();

        expect(alepha.codec.encode(schema, true)).toBe(true);
        expect(alepha.codec.encode(schema, false)).toBe(false);
      });

      it("should reject non-booleans (no coercion)", async () => {
        const alepha = Alepha.create();
        await alepha.start();
        const schema = z.boolean();

        // Strict zod: no value coercion — strings/numbers are rejected.
        expect(() => alepha.codec.validate(schema, "true")).toThrow();
        expect(() => alepha.codec.validate(schema, "false")).toThrow();
        expect(() => alepha.codec.validate(schema, 1)).toThrow();
        expect(() => alepha.codec.validate(schema, 0)).toThrow();
      });
    });

    describe("null", () => {
      it("should decode null", async () => {
        const alepha = Alepha.create();
        await alepha.start();
        const schema = z.null();

        expect(alepha.codec.decode(schema, null)).toBe(null);
      });
    });

    describe("undefined", () => {
      it("should decode undefined", async () => {
        const alepha = Alepha.create();
        await alepha.start();
        const schema = z.undefined();

        expect(alepha.codec.decode(schema, undefined)).toBe(undefined);
      });
    });

    describe("void", () => {
      it("should decode void as undefined", async () => {
        const alepha = Alepha.create();
        await alepha.start();
        const schema = z.void();

        expect(alepha.codec.decode(schema, undefined)).toBe(undefined);
      });
    });

    describe("any", () => {
      it("should accept any value", async () => {
        const alepha = Alepha.create();
        await alepha.start();
        const schema = z.any();

        expect(alepha.codec.decode(schema, "string")).toBe("string");
        expect(alepha.codec.decode(schema, 123)).toBe(123);
        expect(alepha.codec.decode(schema, true)).toBe(true);
        // Strict zod: no null->undefined normalization — null stays null.
        expect(alepha.codec.decode(schema, null)).toBe(null);
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
        const schema = z.text();

        const validText = "a".repeat(255);
        expect(alepha.codec.decode(schema, validText)).toBe(validText);
      });

      it("should trim whitespace by default", async () => {
        const alepha = Alepha.create();
        await alepha.start();
        const schema = z.text();

        expect(alepha.codec.decode(schema, "  hello  ")).toBe("hello");
      });

      it("should reject text over 255 chars", async () => {
        const alepha = Alepha.create();
        await alepha.start();
        const schema = z.text();

        const tooLong = "a".repeat(256);
        expect(() => alepha.codec.validate(schema, tooLong)).toThrow();
      });

      it("should encode text", async () => {
        const alepha = Alepha.create();
        await alepha.start();
        const schema = z.text();

        expect(alepha.codec.encode(schema, "test")).toBe("test");
      });
    });

    describe("text with different sizes", () => {
      it("should validate short text (64 chars max)", async () => {
        const alepha = Alepha.create();
        await alepha.start();
        const shortSchema = z.text({ size: "short" });

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
        const regularSchema = z.text({ size: "regular" });

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
        const longSchema = z.text({ size: "long" });

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
        const richSchema = z.text({ size: "rich" });

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
        const shortSchema = z.shortText();

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
        const longSchema = z.longText();

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
        const richSchema = z.richText();

        expect(alepha.codec.decode(richSchema, "a".repeat(1000))).toBe(
          "a".repeat(1000),
        );
      });
    });

    describe("text trimming option", () => {
      it("should trim when enabled", async () => {
        const alepha = Alepha.create();
        await alepha.start();
        const trimSchema = z.text({ trim: true });

        expect(alepha.codec.decode(trimSchema, "  hello  ")).toBe("hello");
        expect(alepha.codec.decode(trimSchema, "\n\ttest\n\t")).toBe("test");
      });

      it("should not trim when disabled", async () => {
        const alepha = Alepha.create();
        await alepha.start();
        const noTrimSchema = z.text({ trim: false });

        expect(alepha.codec.decode(noTrimSchema, "  hello  ")).toBe(
          "  hello  ",
        );
      });
    });

    describe("text lowercase option", () => {
      it("should lowercase with z.text when enabled", async () => {
        const alepha = Alepha.create();
        await alepha.start();
        const schema = z.text({ lowercase: true });

        expect(alepha.codec.decode(schema, "HELLO")).toBe("hello");
        expect(alepha.codec.decode(schema, "Hello World")).toBe("hello world");
        expect(alepha.codec.decode(schema, "MixedCase123")).toBe(
          "mixedcase123",
        );
      });

      it("should not lowercase enum values (no coercion)", async () => {
        const alepha = Alepha.create();
        await alepha.start();
        const schema = z
          .enum(["active", "inactive", "pending"])
          .meta({ lowercase: true });

        // Strict zod: enum membership is exact — uppercase input is rejected,
        // not lowercased into a matching member.
        expect(alepha.codec.decode(schema, "active")).toBe("active");
        expect(() => alepha.codec.validate(schema, "ACTIVE")).toThrow();
        expect(() => alepha.codec.validate(schema, "INACTIVE")).toThrow();
      });

      it("should combine trim and lowercase with z.text", async () => {
        const alepha = Alepha.create();
        await alepha.start();
        const schema = z.text({ trim: true, lowercase: true });

        expect(alepha.codec.decode(schema, "  HELLO  ")).toBe("hello");
        expect(alepha.codec.decode(schema, "\n\tTEST\n\t")).toBe("test");
      });

      it("should not lowercase when not enabled", async () => {
        const alepha = Alepha.create();
        await alepha.start();
        const schema = z.text();

        expect(alepha.codec.decode(schema, "HELLO")).toBe("HELLO");
        expect(alepha.codec.decode(schema, "MixedCase")).toBe("MixedCase");
      });
    });

    describe("text pattern option (regex)", () => {
      it("should accept values matching the pattern", async () => {
        const alepha = Alepha.create();
        await alepha.start();
        const schema = z.text({ pattern: "^[A-Z]{3}$" });

        expect(alepha.codec.decode(schema, "ABC")).toBe("ABC");
        expect(alepha.codec.decode(schema, "XYZ")).toBe("XYZ");
      });

      it("should reject values not matching the pattern", async () => {
        const alepha = Alepha.create();
        await alepha.start();
        const schema = z.text({ pattern: "^[A-Z]{3}$" });

        expect(() => alepha.codec.validate(schema, "abc")).toThrow();
        expect(() => alepha.codec.validate(schema, "ABCD")).toThrow();
        expect(() => alepha.codec.validate(schema, "AB")).toThrow();
        expect(() => alepha.codec.validate(schema, "123")).toThrow();
      });

      it("should work with alphanumeric pattern", async () => {
        const alepha = Alepha.create();
        await alepha.start();
        const schema = z.text({ pattern: "^[a-zA-Z0-9]+$" });

        expect(alepha.codec.decode(schema, "Hello123")).toBe("Hello123");
        expect(alepha.codec.decode(schema, "test")).toBe("test");
        expect(alepha.codec.decode(schema, "123")).toBe("123");

        expect(() => alepha.codec.validate(schema, "hello world")).toThrow();
        expect(() => alepha.codec.validate(schema, "hello@test")).toThrow();
      });

      it("should work with slug pattern", async () => {
        const alepha = Alepha.create();
        await alepha.start();
        const schema = z.text({ pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$" });

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
        const schema = z.text({ pattern: "^[A-Z]+$", maxLength: 5 });

        expect(alepha.codec.decode(schema, "HELLO")).toBe("HELLO");
        expect(alepha.codec.decode(schema, "AB")).toBe("AB");

        expect(() => alepha.codec.validate(schema, "TOOLONG")).toThrow();
        expect(() => alepha.codec.validate(schema, "hello")).toThrow();
      });

      it("should trim before pattern validation", async () => {
        const alepha = Alepha.create();
        await alepha.start();
        const schema = z.text({ pattern: "^[A-Z]+$", trim: true });

        expect(alepha.codec.decode(schema, "  HELLO  ")).toBe("HELLO");
      });
    });
  });

  describe("Integer Types", () => {
    describe("int (32-bit integer)", () => {
      it("should decode valid 32-bit integers", async () => {
        const alepha = Alepha.create();
        await alepha.start();
        const schema = z.integer();

        expect(alepha.codec.decode(schema, 0)).toBe(0);
        expect(alepha.codec.decode(schema, 123456)).toBe(123456);
        expect(alepha.codec.decode(schema, -123456)).toBe(-123456);
        expect(alepha.codec.decode(schema, 2147483647)).toBe(2147483647);
        expect(alepha.codec.decode(schema, -2147483647)).toBe(-2147483647);
      });

      it("should reject non-integers", async () => {
        const alepha = Alepha.create();
        await alepha.start();
        const schema = z.integer();

        // Strict zod: no truncation — a float is rejected, not floored.
        expect(() => alepha.codec.decode(schema, 3.14)).toThrow();
      });

      it("should reject values outside 32-bit range", async () => {
        const alepha = Alepha.create();
        await alepha.start();
        const schema = z.int32();

        expect(() => alepha.codec.validate(schema, 2147483648)).toThrow();
        expect(() => alepha.codec.validate(schema, -2147483649)).toThrow();
      });
    });

    describe("integer alias", () => {
      it("should work as alias for int", async () => {
        const alepha = Alepha.create();
        await alepha.start();
        const schema = z.int32();

        expect(alepha.codec.decode(schema, 42)).toBe(42);
        // Strict zod: no truncation — a float is rejected.
        expect(() => alepha.codec.decode(schema, 3.14)).toThrow();
      });
    });

    describe("int64", () => {
      it("should decode valid safe integers", async () => {
        const alepha = Alepha.create();
        await alepha.start();
        const schema = z.int64();

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
        const schema = z.int64();

        expect(() => alepha.codec.validate(schema, 3.14)).toThrow();
      });

      it("should reject values outside safe integer range", async () => {
        const alepha = Alepha.create();
        await alepha.start();
        const schema = z.int64();

        expect(() => alepha.codec.validate(schema, 9007199254740992)).toThrow();
        expect(() =>
          alepha.codec.validate(schema, -9007199254740992),
        ).toThrow();
      });
    });
  });

  // Codec Types tests removed - z.bigint(), z.url(), z.binary() are now plain strings without transformation

  describe("Format Types", () => {
    describe("uuid", () => {
      it("should accept valid UUIDs", async () => {
        const alepha = Alepha.create();
        await alepha.start();
        const schema = z.uuid();

        const validUuid = "550e8400-e29b-41d4-a716-446655440000";
        expect(alepha.codec.decode(schema, validUuid)).toBe(validUuid);
      });

      it("should encode UUIDs", async () => {
        const alepha = Alepha.create();
        await alepha.start();
        const schema = z.uuid();

        const validUuid = "550e8400-e29b-41d4-a716-446655440000";
        expect(alepha.codec.encode(schema, validUuid)).toBe(validUuid);
      });

      it("should reject invalid UUIDs", async () => {
        const alepha = Alepha.create();
        await alepha.start();
        const schema = z.uuid();

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
        const schema = z.email();

        expect(alepha.codec.decode(schema, "user@example.com")).toBe(
          "user@example.com",
        );
        expect(
          alepha.codec.decode(schema, "test.user+tag@subdomain.example.co.uk"),
        ).toBe("test.user+tag@subdomain.example.co.uk");
      });

      it("should not trim emails (whitespace rejected)", async () => {
        const alepha = Alepha.create();
        await alepha.start();
        const schema = z.email();

        // Strict zod: no auto-trim — surrounding whitespace makes it invalid.
        expect(() =>
          alepha.codec.validate(schema, "  user@example.com  "),
        ).toThrow();
      });

      it("should not lowercase emails", async () => {
        const alepha = Alepha.create();
        await alepha.start();
        const schema = z.email();

        // Strict zod: no auto-lowercase — case is preserved as-is.
        expect(alepha.codec.decode(schema, "User@Example.COM")).toBe(
          "User@Example.COM",
        );
        expect(alepha.codec.decode(schema, "JOHN.DOE@GMAIL.COM")).toBe(
          "JOHN.DOE@GMAIL.COM",
        );
      });

      it("should not trim or lowercase emails (whitespace rejected)", async () => {
        const alepha = Alepha.create();
        await alepha.start();
        const schema = z.email();

        expect(() =>
          alepha.codec.validate(schema, "  User@Example.COM  "),
        ).toThrow();
      });

      it("should reject invalid emails", async () => {
        const alepha = Alepha.create();
        await alepha.start();
        const schema = z.email();

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
        const schema = z.e164();

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
        const schema = z.e164();

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
        const schema = z.bcp47();

        expect(alepha.codec.decode(schema, "en")).toBe("en");
        expect(alepha.codec.decode(schema, "en-US")).toBe("en-US");
        expect(alepha.codec.decode(schema, "fr")).toBe("fr");
        expect(alepha.codec.decode(schema, "fr-CA")).toBe("fr-CA");
        expect(alepha.codec.decode(schema, "pt-BR")).toBe("pt-BR");
      });

      it("should reject invalid BCP 47 tags", async () => {
        const alepha = Alepha.create();
        await alepha.start();
        const schema = z.bcp47();

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
        const schema = z.constantCase();

        expect(alepha.codec.decode(schema, "HELLO")).toBe("HELLO");
        expect(alepha.codec.decode(schema, "HELLO_WORLD")).toBe("HELLO_WORLD");
        expect(alepha.codec.decode(schema, "TEST-VALUE")).toBe("TEST-VALUE");
        expect(alepha.codec.decode(schema, "A_B_C_D")).toBe("A_B_C_D");
      });

      it("should reject invalid constantCase", async () => {
        const alepha = Alepha.create();
        await alepha.start();
        const schema = z.constantCase();

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
        const schema = z.object({
          name: z.text(),
          age: z.integer(),
          active: z.boolean(),
        });

        const valid = { name: "John", age: 30, active: true };
        const decoded = alepha.codec.decode(schema, valid);
        expect(decoded).toEqual(valid);
      });

      it("should encode objects", async () => {
        const alepha = Alepha.create();
        await alepha.start();
        const schema = z.object({
          name: z.text(),
          age: z.integer(),
          active: z.boolean(),
        });

        const valid = { name: "John", age: 30, active: true };
        const encoded = alepha.codec.encode(schema, valid);
        expect(encoded).toEqual(valid);
      });

      it("should reject missing required fields", async () => {
        const alepha = Alepha.create();
        await alepha.start();
        const schema = z.object({
          name: z.text(),
          age: z.integer(),
          active: z.boolean(),
        });

        expect(() =>
          alepha.codec.validate(schema, { name: "John", age: 30 }),
        ).toThrow();
      });

      it("should reject invalid field types (no coercion)", async () => {
        const alepha = Alepha.create();
        await alepha.start();
        const schema = z.object({
          name: z.text(),
          age: z.integer(),
          active: z.boolean(),
        });

        // Strict zod: a string `age` is rejected, not coerced to a number.
        expect(() =>
          alepha.codec.decode(schema, {
            name: "John",
            age: "30",
            active: true,
          }),
        ).toThrow();
      });

      it("should fix additional properties by default", async () => {
        const alepha = Alepha.create();
        await alepha.start();
        const schema = z.object({
          name: z.text(),
          age: z.integer(),
          active: z.boolean(),
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
        const schema = z.object({
          user: z.object({
            name: z.text(),
            email: z.email(),
          }),
          metadata: z.object({
            createdAt: z.string(),
            updatedAt: z.string(),
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
        const schema = z.array(z.text());

        expect(alepha.codec.decode(schema, [])).toEqual([]);
        expect(alepha.codec.decode(schema, ["a", "b", "c"])).toEqual([
          "a",
          "b",
          "c",
        ]);
      });

      it("does not cap array length by default (native zod arrays are unbounded)", async () => {
        const alepha = Alepha.create();
        await alepha.start();
        // Native `z.array(...)` IS `zod.array(...)` — no implicit max-items cap.
        // Bounds must be set explicitly via `.max()` (see next test).
        const schema = z.array(z.text());

        const big = new Array(1001).fill("x");
        expect(alepha.codec.decode(schema, big)).toEqual(big);
      });

      it("should support custom maxItems", async () => {
        const alepha = Alepha.create();
        await alepha.start();
        const schema = z.array(z.integer()).max(5);

        expect(alepha.codec.decode(schema, [1, 2, 3, 4, 5])).toEqual([
          1, 2, 3, 4, 5,
        ]);
        expect(() =>
          alepha.codec.validate(schema, [1, 2, 3, 4, 5, 6]),
        ).toThrow();
      });

      it("should reject invalid item types (no coercion)", async () => {
        const alepha = Alepha.create();
        await alepha.start();
        const schema = z.array(z.text());

        // Strict zod: a numeric item is rejected, not coerced to a string.
        expect(() =>
          alepha.codec.decode(schema, ["valid", 123, "also valid"]),
        ).toThrow();
      });

      it("should not auto-cast non-array values to a single-element array", async () => {
        const alepha = Alepha.create();
        await alepha.start();
        const schema = z.array(z.text());

        // Strict zod: a scalar is rejected, not wrapped into `[value]`.
        expect(() => alepha.codec.validate(schema, "not an array")).toThrow();
      });

      it("should support array of objects", async () => {
        const alepha = Alepha.create();
        await alepha.start();
        const schema = z.array(
          z.object({
            id: z.integer(),
            name: z.text(),
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
        const schema = z.union([z.text(), z.integer()]);

        expect(alepha.codec.decode(schema, "hello")).toBe("hello");
        expect(alepha.codec.decode(schema, 123)).toBe(123);
      });

      it("should reject types not in the union", async () => {
        const alepha = Alepha.create();
        await alepha.start();
        const schema = z.union([z.text(), z.integer()]);

        expect(() => alepha.codec.validate(schema, {})).toThrow();
      });

      it("should support union of object types", async () => {
        const alepha = Alepha.create();
        await alepha.start();
        const schema = z.union([
          z.object({ type: z.const("A"), value: z.text() }),
          z.object({ type: z.const("B"), count: z.integer() }),
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
        const schema = z.record(z.text(), z.integer());

        const valid = { a: 1, b: 2, c: 3 };
        expect(alepha.codec.decode(schema, valid)).toEqual(valid);
      });

      it("should accept empty records", async () => {
        const alepha = Alepha.create();
        await alepha.start();
        const schema = z.record(z.text(), z.integer());

        expect(alepha.codec.decode(schema, {})).toEqual({});
      });

      it("should reject invalid value types", async () => {
        const alepha = Alepha.create();
        await alepha.start();
        const schema = z.record(z.text(), z.integer());

        expect(() =>
          alepha.codec.validate(schema, { a: "not a number" }),
        ).toThrow();
      });
    });

    describe("json", () => {
      it("should accept any JSON object", async () => {
        const alepha = Alepha.create();
        await alepha.start();
        const schema = z.json();

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
        const schema = z.tuple([z.text(), z.integer(), z.boolean()]);

        expect(alepha.codec.decode(schema, ["hello", 42, true])).toEqual([
          "hello",
          42,
          true,
        ]);
      });

      it("should reject tuples with wrong length", async () => {
        const alepha = Alepha.create();
        await alepha.start();
        const schema = z.tuple([
          z.text(),
          z.integer(),
          z.object({
            flag: z.boolean(),
          }),
        ]);

        expect(() => alepha.codec.validate(schema, ["hello", 42])).toThrow();
        // Strict zod: an over-long tuple is rejected, not truncated.
        expect(() =>
          alepha.codec.decode(schema, ["hello", 42, { flag: true }, "extra"]),
        ).toThrow();
      });

      it("should reject tuples with wrong types", async () => {
        const alepha = Alepha.create();
        await alepha.start();
        const schema = z.tuple([z.text(), z.integer(), z.boolean()]);

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
        const schema = z.object({
          required: z.text(),
          optional: z.text().optional(),
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
        const schema = z.object({
          value: z.text().nullable(),
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
        const schema = z.object({
          value: z.text().nullable(),
        });

        expect(() => alepha.codec.validate(schema, {})).toThrow();
      });
    });

    describe("optional nullable", () => {
      it("should allow string, null, or omitted", async () => {
        const alepha = Alepha.create();
        await alepha.start();
        const schema = z.object({
          value: z.text().nullable().optional(),
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
        const baseSchema = z.object({
          name: z.text(),
          age: z.integer(),
          email: z.email(),
        });

        const partialSchema = baseSchema.partial();

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
        const baseSchema = z.object({
          id: z.integer(),
          name: z.text(),
          email: z.email(),
          age: z.integer(),
        });

        const pickedSchema = baseSchema.pick({ name: true, email: true });

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
        const baseSchema = z.object({
          id: z.integer(),
          name: z.text(),
          email: z.email(),
          age: z.integer(),
        });

        const pickedSchema = baseSchema.pick({ name: true, email: true });

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
        const baseSchema = z.object({
          id: z.integer(),
          name: z.text(),
          email: z.email(),
          age: z.integer(),
        });

        const pickedSchema = baseSchema.pick({ name: true, email: true });

        expect(() =>
          alepha.codec.validate(pickedSchema, { name: "John" }),
        ).toThrow();
      });
    });

    describe("omit", () => {
      it("should omit specified fields", async () => {
        const alepha = Alepha.create();
        await alepha.start();
        const baseSchema = z.object({
          id: z.integer(),
          name: z.text(),
          email: z.email(),
          password: z.text(),
        });

        const omittedSchema = baseSchema.omit({ password: true });

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
        const baseSchema = z.object({
          id: z.integer(),
          name: z.text(),
          email: z.email(),
          password: z.text(),
        });

        const omittedSchema = baseSchema.omit({ password: true });

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
        const schema = z.enum(["ACTIVE", "INACTIVE", "PENDING"]);

        expect(alepha.codec.decode(schema, "ACTIVE")).toBe("ACTIVE");
        expect(alepha.codec.decode(schema, "INACTIVE")).toBe("INACTIVE");
        expect(alepha.codec.decode(schema, "PENDING")).toBe("PENDING");
      });

      it("should reject invalid enum values", async () => {
        const alepha = Alepha.create();
        await alepha.start();
        const schema = z.enum(["ACTIVE", "INACTIVE", "PENDING"]);

        expect(() => alepha.codec.validate(schema, "INVALID")).toThrow();
        expect(() => alepha.codec.validate(schema, "active")).toThrow(); // Case sensitive
        expect(() => alepha.codec.validate(schema, "")).toThrow();
      });
    });

    describe("const (literal)", () => {
      it("should accept only the literal value", async () => {
        const alepha = Alepha.create();
        await alepha.start();
        const schema = z.const("FIXED_VALUE");

        expect(alepha.codec.decode(schema, "FIXED_VALUE")).toBe("FIXED_VALUE");
      });

      it("should reject non-matching values", async () => {
        const alepha = Alepha.create();
        await alepha.start();
        const schema = z.const("FIXED_VALUE");

        expect(() => alepha.codec.validate(schema, "OTHER_VALUE")).toThrow();
        expect(() => alepha.codec.validate(schema, "")).toThrow();
      });

      it("should support number literals", async () => {
        const alepha = Alepha.create();
        await alepha.start();
        const schema = z.const(42);

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
        const schema = z.valueLabel();

        const valid = {
          value: "ACTIVE",
          label: "Active Status",
        };
        expect(alepha.codec.decode(schema, valid)).toEqual(valid);
      });

      it("should support optional description", async () => {
        const alepha = Alepha.create();
        await alepha.start();
        const schema = z.valueLabel();

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
        const schema = z.valueLabel();

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
        const schema = z.file();

        expect(schema).toBeDefined();
        // Format tag now lives in zod `.meta()`, read via `z.schema.format`.
        expect(z.schema.format(schema)).toBe("binary");
      });

      it("carries maxBytes through to the schema's metadata", async () => {
        const alepha = Alepha.create();
        await alepha.start();
        const schema = z.file({ maxBytes: 1024 * 1024 });

        expect(z.schema.format(schema)).toBe("binary");
        // Asserted, not merely defined: the multipart layer reads this to
        // decide the request's budget, and the option spent years being
        // accepted and never read by anyone.
        expect(z.schema.meta(schema).maxBytes).toBe(1024 * 1024);
      });
    });

    describe("stream", () => {
      it("should create stream schema", async () => {
        const alepha = Alepha.create();
        await alepha.start();
        const schema = z.stream();

        expect(schema).toBeDefined();
        expect(z.schema.format(schema)).toBe("stream");
      });
    });
  });

  describe("Complex Scenarios", () => {
    it("should handle complex nested structures", async () => {
      const alepha = Alepha.create();
      await alepha.start();

      const schema = z.object({
        id: z.uuid(),
        user: z.object({
          name: z.shortText(),
          email: z.email(),
          age: z.integer().optional(),
          roles: z.array(z.enum(["ADMIN", "USER", "GUEST"])),
        }),
        metadata: z
          .object({
            createdAt: z.string(),
            tags: z.array(z.text()),
          })
          .nullable(),
        settings: z.record(z.text(), z.boolean()),
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

      const schema = z.object({
        text: z.text(),
        number: z.number(),
        bool: z.boolean(),
        array: z.array(z.integer()),
        nested: z.object({
          key: z.text(),
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

      const schema = z.object({
        name: z.text(),
        age: z.integer(),
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
      const { schema } = z;

      expect(schema.isString(z.text())).toBe(true);
      expect(schema.isString(z.integer())).toBe(false);
    });

    it("should correctly identify number schemas", () => {
      const { schema } = z;

      expect(schema.isNumber(z.number())).toBe(true);
      expect(schema.isNumber(z.text())).toBe(false);
    });

    it("should correctly identify integer schemas", () => {
      const { schema } = z;

      expect(schema.isInteger(z.integer())).toBe(true);
      expect(schema.isInteger(z.number())).toBe(false);
    });

    it("should correctly identify boolean schemas", () => {
      const { schema } = z;

      expect(schema.isBoolean(z.boolean())).toBe(true);
      expect(schema.isBoolean(z.text())).toBe(false);
    });

    it("should correctly identify object schemas", () => {
      const { schema } = z;

      expect(schema.isObject(z.object({ key: z.text() }))).toBe(true);
      expect(schema.isObject(z.array(z.text()))).toBe(false);
    });

    it("should correctly identify array schemas", () => {
      const { schema } = z;

      expect(schema.isArray(z.array(z.text()))).toBe(true);
      expect(schema.isArray(z.text())).toBe(false);
    });

    it("should correctly identify union schemas", () => {
      const { schema } = z;

      expect(schema.isUnion(z.union([z.text(), z.integer()]))).toBe(true);
      expect(schema.isUnion(z.text())).toBe(false);
    });

    it("should correctly identify optional schemas", () => {
      const { schema } = z;

      expect(schema.isOptional(z.text().optional())).toBe(true);
      expect(schema.isOptional(z.text())).toBe(false);
    });

    it("should correctly identify null schemas", () => {
      const { schema } = z;

      expect(schema.isNull(z.null())).toBe(true);
      expect(schema.isNull(z.undefined())).toBe(false);
    });

    it("should correctly identify undefined schemas", () => {
      const { schema } = z;

      expect(schema.isUndefined(z.undefined())).toBe(true);
      expect(schema.isUndefined(z.null())).toBe(false);
    });

    it("should correctly identify any schemas", () => {
      const { schema } = z;

      expect(schema.isAny(z.any())).toBe(true);
      expect(schema.isAny(z.text())).toBe(false);
    });

    it("should correctly identify record schemas", () => {
      const { schema } = z;

      expect(schema.isRecord(z.record(z.text(), z.integer()))).toBe(true);
      expect(schema.isRecord(z.object({}))).toBe(false);
    });

    it("should correctly identify tuple schemas", () => {
      const { schema } = z;

      expect(schema.isTuple(z.tuple([z.text(), z.integer()]))).toBe(true);
      expect(schema.isTuple(z.array(z.text()))).toBe(false);
    });

    it("should correctly identify void schemas", () => {
      const { schema } = z;

      expect(schema.isVoid(z.void())).toBe(true);
      expect(schema.isVoid(z.undefined())).toBe(false);
    });

    it("should correctly identify uuid schemas", () => {
      const { schema } = z;

      expect(schema.isUUID(z.uuid())).toBe(true);
      expect(schema.isUUID(z.text())).toBe(false);
    });

    it("should correctly identify bigint schemas", () => {
      const { schema } = z;

      expect(schema.isBigInt(z.bigint())).toBe(true);
      expect(schema.isBigInt(z.integer())).toBe(false);
    });

    it("should correctly identify scalar schemas", () => {
      const { schema } = z;

      expect(schema.isScalar(z.string())).toBe(true);
      expect(schema.isScalar(z.number())).toBe(true);
      expect(schema.isScalar(z.integer())).toBe(true);
      expect(schema.isScalar(z.boolean())).toBe(true);
      expect(schema.isScalar(z.object({}))).toBe(false);
      expect(schema.isScalar(z.array(z.string()))).toBe(false);
    });
  });
});
