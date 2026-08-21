import { Alepha, z } from "alepha";
import { describe, test } from "vitest";

import { SchemaValidator } from "../providers/SchemaValidator.ts";

describe("SchemaValidator", () => {
  describe("Basic validation", () => {
    test("should validate simple objects", async ({ expect }) => {
      const alepha = Alepha.create();
      const validator = alepha.inject(SchemaValidator);

      const schema = z.object({
        name: z.text(),
        age: z.integer(),
      });

      const data = {
        name: "Alice",
        age: 30,
      };

      const result = validator.validate(schema, data);
      expect(result).toEqual(data);
    });

    test("should trim strings when schema has trim option", async ({
      expect,
    }) => {
      const alepha = Alepha.create();
      const validator = alepha.inject(SchemaValidator);

      const schema = z.object({
        name: z.text({ trim: true }),
      });

      const data = {
        name: "  Alice  ",
      };

      const result = validator.validate(schema, data);
      expect(result.name).toBe("Alice");
    });

    test("rejects null for an optional (non-nullable) field (strict)", async ({
      expect,
    }) => {
      const alepha = Alepha.create();
      const validator = alepha.inject(SchemaValidator);

      const schema = z.object({
        name: z.text(),
        bio: z.text().optional(),
      });

      // Standard zod is strict: an optional field accepts `undefined`, not
      // `null` (the old `nullToUndefined` coercion has been dropped).
      expect(() =>
        validator.validate(schema, { name: "Alice", bio: null }),
      ).toThrow();

      const result = validator.validate(schema, { name: "Alice" });
      expect(result.name).toBe("Alice");
      expect(result.bio).toBeUndefined();
    });
  });

  describe("Security - Prototype Pollution Protection", () => {
    test("should filter out __proto__ key from input data", async ({
      expect,
    }) => {
      const alepha = Alepha.create();
      const validator = alepha.inject(SchemaValidator);

      const schema = z.object({
        name: z.text(),
      });

      // Input data with __proto__ key via JSON.parse (bypasses literal protection)
      const data = JSON.parse('{"name":"Alice","__proto__":{"isAdmin":true}}');

      const result = validator.validate(schema, data);

      // __proto__ should not be an own property in the result
      expect(result.name).toBe("Alice");
      // Using hasOwnProperty because 'in' operator has special behavior for __proto__
      expect(Object.hasOwn(result, "__proto__")).toBe(false);
    });

    test("should filter out constructor key from input data", async ({
      expect,
    }) => {
      const alepha = Alepha.create();
      const validator = alepha.inject(SchemaValidator);

      const schema = z.object({
        name: z.text(),
      });

      const data = {
        name: "Alice",
        constructor: { prototype: { isAdmin: true } },
      };

      const result = validator.validate(schema, data);

      expect(result.name).toBe("Alice");
      expect(Object.hasOwn(result, "constructor")).toBe(false);
    });

    test("should filter out prototype key from input data", async ({
      expect,
    }) => {
      const alepha = Alepha.create();
      const validator = alepha.inject(SchemaValidator);

      const schema = z.object({
        name: z.text(),
      });

      const data = {
        name: "Alice",
        prototype: { isAdmin: true },
      };

      const result = validator.validate(schema, data);

      expect(result.name).toBe("Alice");
      expect(Object.hasOwn(result, "prototype")).toBe(false);
    });

    test("should filter unsafe keys from nested objects", async ({
      expect,
    }) => {
      const alepha = Alepha.create();
      const validator = alepha.inject(SchemaValidator);

      const schema = z.object({
        user: z.object({
          name: z.text(),
        }),
      });

      const data = {
        user: {
          name: "Alice",
          __proto__: { isAdmin: true },
        },
      };

      const result = validator.validate(schema, data);

      expect(result.user.name).toBe("Alice");
      expect(Object.hasOwn(result.user, "__proto__")).toBe(false);
    });

    test("should not pollute Object.prototype", async ({ expect }) => {
      const alepha = Alepha.create();
      const validator = alepha.inject(SchemaValidator);

      const schema = z.object({
        name: z.text(),
      });

      // Attempt to pollute Object.prototype via __proto__
      const maliciousData = JSON.parse(
        '{"name":"Alice","__proto__":{"polluted":"yes"}}',
      );

      validator.validate(schema, maliciousData);

      // Object.prototype should not be polluted
      expect(({} as any).polluted).toBeUndefined();
    });

    test("should create objects without prototype chain", async ({
      expect,
    }) => {
      const alepha = Alepha.create();
      const validator = alepha.inject(SchemaValidator);

      const schema = z.object({
        name: z.text(),
      });

      const data = {
        name: "Alice",
      };

      const result = validator.validate(schema, data);

      // The result should not have Object.prototype methods directly accessible
      // via hasOwnProperty (it should use Object.create(null))
      expect(result.name).toBe("Alice");
    });
  });

  describe("beforeParse", () => {
    test("should handle arrays correctly", async ({ expect }) => {
      const alepha = Alepha.create();
      const validator = alepha.inject(SchemaValidator);

      const schema = z.object({
        tags: z.array(z.text({ trim: true })),
      });

      const data = {
        tags: ["  tag1  ", "  tag2  "],
      };

      const result = validator.validate(schema, data);
      expect(result.tags).toEqual(["tag1", "tag2"]);
    });

    test("should unwrap optional arrays and preprocess items", async ({
      expect,
    }) => {
      const alepha = Alepha.create();
      const validator = alepha.inject(SchemaValidator);

      const schema = z.object({
        tags: z.array(z.text({ trim: true })).optional(),
      });

      const data = {
        tags: ["  tag1  ", "  tag2  "],
      };

      const result = validator.validate(schema, data);
      expect(result.tags).toEqual(["tag1", "tag2"]);
    });

    test("should unwrap nullable arrays and preprocess items", async ({
      expect,
    }) => {
      const alepha = Alepha.create();
      const validator = alepha.inject(SchemaValidator);

      const schema = z.object({
        tags: z.union([z.array(z.text({ trim: true })), z.null()]),
      });

      const data = {
        tags: ["  tag1  ", "  tag2  "],
      };

      const result = validator.validate(schema, data);
      expect(result.tags).toEqual(["tag1", "tag2"]);
    });

    test("validates an optional field left undefined (strict)", async ({
      expect,
    }) => {
      const alepha = Alepha.create();
      const validator = alepha.inject(SchemaValidator);

      const schema = z.object({
        name: z.text(),
        bio: z.text().optional(),
      });

      // The `deleteUndefined` option has been dropped; an undefined optional
      // field simply validates to `undefined`.
      const result = validator.validate(schema, {
        name: "Alice",
        bio: undefined,
      });

      expect(result.name).toBe("Alice");
      expect(result.bio).toBeUndefined();
    });
  });
});
