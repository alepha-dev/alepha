import { Alepha, z } from "alepha";
import { describe, it } from "vitest";

import { SchemaValidationError } from "../errors/SchemaValidationError.ts";
import { SchemaValidator } from "../providers/SchemaValidator.ts";

describe("SchemaValidator", () => {
  describe("Basic validation", () => {
    it("should validate simple objects", async ({ expect }) => {
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

    it("should trim strings when schema has trim option", async ({
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

    it("rejects null for an optional (non-nullable) field (strict)", async ({
      expect,
    }) => {
      const alepha = Alepha.create();
      const validator = alepha.inject(SchemaValidator);

      const schema = z.object({
        name: z.text(),
        bio: z.text().optional(),
      });

      // Standard zod is strict: an optional field accepts `undefined`, not
      // `null`.
      expect(() =>
        validator.validate(schema, { name: "Alice", bio: null }),
      ).toThrow();

      const result = validator.validate(schema, { name: "Alice" });
      expect(result.name).toBe("Alice");
      expect(result.bio).toBeUndefined();
    });
  });

  describe("Security - Prototype Pollution Protection", () => {
    it("should filter out __proto__ key from input data", async ({
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

    it("should filter out constructor key from input data", async ({
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

    it("should filter out prototype key from input data", async ({
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

    it("should filter unsafe keys from nested objects", async ({ expect }) => {
      const alepha = Alepha.create();
      const validator = alepha.inject(SchemaValidator);

      const schema = z.object({
        user: z.object({
          name: z.text(),
        }),
      });

      // JSON.parse, because `__proto__` in an object literal sets the prototype
      // and creates no own key.
      const data = JSON.parse(
        '{"user":{"name":"Alice","__proto__":{"isAdmin":true}}}',
      );
      expect(Object.hasOwn(data.user, "__proto__")).toBe(true);

      const result = validator.validate(schema, data);

      expect(result.user.name).toBe("Alice");
      expect(Object.hasOwn(result.user, "__proto__")).toBe(false);
      expect((result.user as any).isAdmin).toBeUndefined();
    });

    it("should not pollute Object.prototype", async ({ expect }) => {
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
  });

  describe("arrays and optional fields", () => {
    it("should handle arrays correctly", async ({ expect }) => {
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

    it("should trim the items of an optional array", async ({ expect }) => {
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

    it("should trim the items of a nullable array", async ({ expect }) => {
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

    it("validates an optional field left undefined (strict)", async ({
      expect,
    }) => {
      const alepha = Alepha.create();
      const validator = alepha.inject(SchemaValidator);

      const schema = z.object({
        name: z.text(),
        bio: z.text().optional(),
      });

      // An undefined optional field validates to `undefined`.
      const result = validator.validate(schema, {
        name: "Alice",
        bio: undefined,
      });

      expect(result.name).toBe("Alice");
      expect(result.bio).toBeUndefined();
    });
  });
  describe("issues", () => {
    const failure = (schema: any, value: unknown) => {
      const validator = Alepha.create().inject(SchemaValidator);
      try {
        validator.validate(schema, value);
      } catch (error) {
        if (error instanceof SchemaValidationError) return error;
        throw error;
      }
      throw new Error("expected a SchemaValidationError");
    };

    it("keeps every issue, with path and message the first one", ({
      expect,
    }) => {
      const error = failure(
        z.object({
          title: z.text(),
          email: z.email(),
          items: z.array(z.object({ name: z.text() })),
        }),
        { email: "nope", items: [{ name: "a" }, {}] },
      );

      expect(error.data.path).toBe("/title");
      expect(error.data.message).toBe("'title' is required");
      expect(error.data.issues?.map((issue) => issue.path)).toEqual([
        "/title",
        "/email",
        "/items/1/name",
      ]);
      expect(error.data.issues?.[2].message).toBe("'items/1/name' is required");
    });

    it("caps the issues at MAX_ISSUES", ({ expect }) => {
      const error = failure(
        z.array(z.integer()),
        Array.from({ length: 80 }, () => "x"),
      );
      expect(error.data.issues).toHaveLength(SchemaValidator.MAX_ISSUES);
    });
  });
});
