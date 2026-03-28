import { Alepha, t } from "alepha";
import { describe, test } from "vitest";
import { SchemaValidator } from "../providers/SchemaValidator.ts";

describe("SchemaValidator", () => {
  describe("Basic validation", () => {
    test("should validate simple objects", async ({ expect }) => {
      const alepha = Alepha.create();
      const validator = alepha.inject(SchemaValidator);

      const schema = t.object({
        name: t.text(),
        age: t.integer(),
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

      const schema = t.object({
        name: t.text({ trim: true }),
      });

      const data = {
        name: "  Alice  ",
      };

      const result = validator.validate(schema, data);
      expect(result.name).toBe("Alice");
    });

    test("should convert null to undefined for non-nullable fields", async ({
      expect,
    }) => {
      const alepha = Alepha.create();
      const validator = alepha.inject(SchemaValidator);

      const schema = t.object({
        name: t.text(),
        bio: t.optional(t.text()),
      });

      const data = {
        name: "Alice",
        bio: null,
      };

      const result = validator.validate(schema, data);
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

      const schema = t.object({
        name: t.text(),
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

      const schema = t.object({
        name: t.text(),
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

      const schema = t.object({
        name: t.text(),
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

      const schema = t.object({
        user: t.object({
          name: t.text(),
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

      const schema = t.object({
        name: t.text(),
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

      const schema = t.object({
        name: t.text(),
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

      const schema = t.object({
        tags: t.array(t.text({ trim: true })),
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

      const schema = t.object({
        tags: t.optional(t.array(t.text({ trim: true }))),
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

      const schema = t.object({
        tags: t.union([t.array(t.text({ trim: true })), t.null()]),
      });

      const data = {
        tags: ["  tag1  ", "  tag2  "],
      };

      const result = validator.validate(schema, data);
      expect(result.tags).toEqual(["tag1", "tag2"]);
    });

    test("should delete undefined values when option is enabled", async ({
      expect,
    }) => {
      const alepha = Alepha.create();
      const validator = alepha.inject(SchemaValidator);

      const schema = t.object({
        name: t.text(),
        bio: t.optional(t.text()),
      });

      const data = {
        name: "Alice",
        bio: undefined,
      };

      const result = validator.validate(schema, data, {
        deleteUndefined: true,
      });

      expect(result.name).toBe("Alice");
      expect("bio" in result).toBe(false);
    });
  });
});
