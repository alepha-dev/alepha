import { Alepha } from "alepha";
import { describe, expect, it } from "vitest";
import { QueryManager } from "../services/QueryManager.ts";

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
});
