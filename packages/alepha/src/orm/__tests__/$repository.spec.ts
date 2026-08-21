import { Alepha } from "alepha";
import { describe, it } from "vitest";

import { AlephaOrmPostgres } from "../postgres/index.ts";
import {
  testAllTypes,
  testBasicCrud,
  testConditionsWithSiblings,
  testCrudWithTimestamps,
  testMultipleOperators,
  testOrderByModes,
  testPagination,
  testPaginationSort,
  testPaginationWithQueryLimit,
  testPgAttr,
  testRepositoryHooks,
  testSaveWithCustomPrimaryKey,
  testSaveWithDeletedFields,
  testSerialIdOperations,
  testTransactionThrowsWhenUnsupported,
  testUpsert,
  testUuidIdOperations,
} from "./$repository-tests.ts";

describe("$repository", () => {
  describe("attributes", () => {
    it("should filter out attributes not defined in schema (sqlite)", async () => {
      await testPgAttr(
        Alepha.create({ env: { DATABASE_URL: "sqlite://:memory:" } }),
      );
    });
    it("should filter out attributes not defined in schema (postgres)", async () => {
      await testPgAttr(Alepha.create().with(AlephaOrmPostgres));
    });
  });

  describe("all types", () => {
    it("should handle all supported data types (sqlite)", async () => {
      await testAllTypes(
        Alepha.create({ env: { DATABASE_URL: "sqlite://:memory:" } }),
      );
    });
    it("should handle all supported data types (postgres)", async () => {
      await testAllTypes(Alepha.create().with(AlephaOrmPostgres));
    });
  });

  describe("crud", () => {
    it("should support basic CRUD operations (sqlite)", async () => {
      await testBasicCrud(
        Alepha.create({ env: { DATABASE_URL: "sqlite://:memory:" } }),
      );
    });
    it("should support basic CRUD operations (postgres)", async () => {
      await testBasicCrud(Alepha.create().with(AlephaOrmPostgres));
    });
  });

  describe("hooks", () => {
    it("should fire hooks for all operations (sqlite)", async () => {
      await testRepositoryHooks(
        Alepha.create({ env: { DATABASE_URL: "sqlite://:memory:" } }),
      );
    });
    it("should fire hooks for all operations (postgres)", async () => {
      await testRepositoryHooks(Alepha.create().with(AlephaOrmPostgres));
    });
  });

  describe("or/and with sibling conditions", () => {
    it("should AND-combine or/and with sibling field conditions (sqlite)", async () => {
      await testConditionsWithSiblings(
        Alepha.create({ env: { DATABASE_URL: "sqlite://:memory:" } }),
      );
    });
    it("should AND-combine or/and with sibling field conditions (postgres)", async () => {
      await testConditionsWithSiblings(Alepha.create().with(AlephaOrmPostgres));
    });
  });

  describe("orderBy", () => {
    it("should support all 3 orderBy modes (sqlite)", async () => {
      await testOrderByModes(
        Alepha.create({ env: { DATABASE_URL: "sqlite://:memory:" } }),
      );
    });
    it("should support all 3 orderBy modes (postgres)", async () => {
      await testOrderByModes(Alepha.create().with(AlephaOrmPostgres));
    });
  });

  describe("pagination sort", () => {
    it("should support pagination with sort format (sqlite)", async () => {
      await testPaginationSort(
        Alepha.create({ env: { DATABASE_URL: "sqlite://:memory:" } }),
      );
    });
    it("should support pagination with sort format (postgres)", async () => {
      await testPaginationSort(Alepha.create().with(AlephaOrmPostgres));
    });
  });

  describe("save", () => {
    it("should save an entity with deleted fields (sqlite)", async () => {
      await testSaveWithDeletedFields(
        Alepha.create({ env: { DATABASE_URL: "sqlite://:memory:" } }),
      );
    });
    it("should save an entity with deleted fields (postgres)", async () => {
      await testSaveWithDeletedFields(Alepha.create().with(AlephaOrmPostgres));
    });
    it("should save an entity with custom primary key (sqlite)", async () => {
      await testSaveWithCustomPrimaryKey(
        Alepha.create({ env: { DATABASE_URL: "sqlite://:memory:" } }),
      );
    });
    it("should save an entity with custom primary key (postgres)", async () => {
      await testSaveWithCustomPrimaryKey(
        Alepha.create().with(AlephaOrmPostgres),
      );
    });
  });

  describe("transaction", () => {
    it("should throw when driver does not support transactions (sqlite)", async () => {
      await testTransactionThrowsWhenUnsupported(
        Alepha.create({ env: { DATABASE_URL: "sqlite://:memory:" } }),
      );
    });
  });

  describe("upsert", () => {
    it("should support upsert operations (sqlite)", async () => {
      await testUpsert(
        Alepha.create({ env: { DATABASE_URL: "sqlite://:memory:" } }),
      );
    });
    it("should support upsert operations (postgres)", async () => {
      await testUpsert(Alepha.create().with(AlephaOrmPostgres));
    });
  });

  describe("id operations", () => {
    it("should handle serial id operations (sqlite)", async () => {
      await testSerialIdOperations(
        Alepha.create({ env: { DATABASE_URL: "sqlite://:memory:" } }),
      );
    });
    it("should handle serial id operations (postgres)", async () => {
      await testSerialIdOperations(Alepha.create().with(AlephaOrmPostgres));
    });
    it("should handle uuid id operations (sqlite)", async () => {
      await testUuidIdOperations(
        Alepha.create({ env: { DATABASE_URL: "sqlite://:memory:" } }),
      );
    });
    it("should handle uuid id operations (postgres)", async () => {
      await testUuidIdOperations(Alepha.create().with(AlephaOrmPostgres));
    });
    it("should handle multiple operators gte & lte (sqlite)", async () => {
      await testMultipleOperators(
        Alepha.create({ env: { DATABASE_URL: "sqlite://:memory:" } }),
      );
    });
    it("should handle multiple operators gte & lte (postgres)", async () => {
      await testMultipleOperators(Alepha.create().with(AlephaOrmPostgres));
    });
  });

  describe("timestamps", () => {
    it("should handle CRUD with timestamps (sqlite)", async () => {
      await testCrudWithTimestamps(
        Alepha.create({ env: { DATABASE_URL: "sqlite://:memory:" } }),
      );
    });
    it("should handle CRUD with timestamps (postgres)", async () => {
      await testCrudWithTimestamps(Alepha.create().with(AlephaOrmPostgres));
    });
  });

  describe("pagination", () => {
    it("should return correct pagination metadata (sqlite)", async () => {
      await testPagination(
        Alepha.create({ env: { DATABASE_URL: "sqlite://:memory:" } }),
      );
    });
    it("should return correct pagination metadata (postgres)", async () => {
      await testPagination(Alepha.create().with(AlephaOrmPostgres));
    });
    it("should detect the next page when size comes from query.limit (sqlite)", async () => {
      await testPaginationWithQueryLimit(
        Alepha.create({ env: { DATABASE_URL: "sqlite://:memory:" } }),
      );
    });
    it("should detect the next page when size comes from query.limit (postgres)", async () => {
      await testPaginationWithQueryLimit(
        Alepha.create().with(AlephaOrmPostgres),
      );
    });
  });
});
