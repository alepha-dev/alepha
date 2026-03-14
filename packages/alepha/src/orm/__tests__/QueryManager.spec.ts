import { Alepha, t } from "alepha";
import type { PgColumn } from "drizzle-orm/pg-core";
import { boolean, integer, pgTable, text } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { QueryManager } from "../core/services/QueryManager.ts";

const testTable = pgTable("test", {
  age: integer("age"),
  name: text("name"),
  active: boolean("active"),
});

const testSchema = t.object({
  age: t.number(),
  name: t.text(),
  active: t.boolean(),
});

const col = (key: string) => (testTable as any)[key] as PgColumn;

describe("QueryManager", () => {
  const alepha = Alepha.create();
  const qm = alepha.inject(QueryManager);

  describe("parsePaginationSort", () => {
    it("should parse single ascending column", () => {
      const result = qm.parsePaginationSort("name");
      expect(result).toEqual({ column: "name", direction: "asc" });
    });

    it("should parse single descending column", () => {
      const result = qm.parsePaginationSort("-createdAt");
      expect(result).toEqual({ column: "createdAt", direction: "desc" });
    });

    it("should parse multiple columns", () => {
      const result = qm.parsePaginationSort("firstName,-lastName");
      expect(result).toEqual([
        { column: "firstName", direction: "asc" },
        { column: "lastName", direction: "desc" },
      ]);
    });

    it("should handle whitespace around columns", () => {
      const result = qm.parsePaginationSort("name , -age");
      expect(result).toEqual([
        { column: "name", direction: "asc" },
        { column: "age", direction: "desc" },
      ]);
    });

    it("should parse multiple ascending and descending columns", () => {
      const result = qm.parsePaginationSort("-priority,status,-createdAt");
      expect(result).toEqual([
        { column: "priority", direction: "desc" },
        { column: "status", direction: "asc" },
        { column: "createdAt", direction: "desc" },
      ]);
    });
  });

  describe("normalizeOrderBy", () => {
    it("should normalize string to array", () => {
      const result = qm.normalizeOrderBy("name");
      expect(result).toEqual([{ column: "name", direction: "asc" }]);
    });

    it("should normalize object to array", () => {
      const result = qm.normalizeOrderBy({
        column: "age",
        direction: "desc",
      });
      expect(result).toEqual([{ column: "age", direction: "desc" }]);
    });

    it("should default direction to asc for object mode", () => {
      const result = qm.normalizeOrderBy({ column: "name" });
      expect(result).toEqual([{ column: "name", direction: "asc" }]);
    });

    it("should normalize array with default directions", () => {
      const result = qm.normalizeOrderBy([
        { column: "name" },
        { column: "age", direction: "desc" },
      ]);
      expect(result).toEqual([
        { column: "name", direction: "asc" },
        { column: "age", direction: "desc" },
      ]);
    });

    it("should return empty array for undefined", () => {
      expect(qm.normalizeOrderBy(undefined)).toEqual([]);
    });

    it("should return empty array for non-object non-string non-array", () => {
      expect(qm.normalizeOrderBy(42)).toEqual([]);
    });
  });

  describe("toSQL", () => {
    const options = {
      schema: testSchema,
      col,
      dialect: "postgresql" as const,
    };

    it("should produce a condition when filtering by zero", () => {
      const result = qm.toSQL({ age: 0 } as any, options);

      expect(result).toBeDefined();
    });

    it("should produce a condition when filtering by false", () => {
      const result = qm.toSQL({ active: false } as any, options);

      expect(result).toBeDefined();
    });

    it("should produce a condition when filtering by empty string", () => {
      const result = qm.toSQL({ name: "" } as any, options);

      expect(result).toBeDefined();
    });

    it("should produce a condition when filtering by string value", () => {
      const result = qm.toSQL({ name: "alice" } as any, options);

      expect(result).toBeDefined();
    });

    it("should produce a condition when filtering with eq operator on zero", () => {
      const result = qm.toSQL({ age: { eq: 0 } } as any, options);

      expect(result).toBeDefined();
    });

    it("should return undefined for null values", () => {
      const result = qm.toSQL({ age: null } as any, options);

      expect(result).toBeUndefined();
    });

    it("should return undefined for undefined values", () => {
      const result = qm.toSQL({ age: undefined } as any, options);

      expect(result).toBeUndefined();
    });
  });
});
