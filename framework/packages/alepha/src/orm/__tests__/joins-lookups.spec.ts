import { Alepha } from "alepha";
import { AlephaOrmTestPostgres } from "alepha/orm";
import { describe, it } from "vitest";

import {
  testFindOneWithJoinReturnsUndefined,
  testGetByIdWithRelations,
  testGetOneWithJoinThrowsWhenNotFound,
  testMultipleOperatorsOnJoinedFilter,
  testOrFilterAcrossTables,
} from "./joins-lookups-tests.ts";

describe("joins: OR across tables, lookups by one row", () => {
  describe("OR filter across tables", () => {
    it("should OR across base and joined table (sqlite)", async () => {
      await testOrFilterAcrossTables(
        Alepha.create({ env: { DATABASE_URL: "sqlite://:memory:" } }),
      );
    });
    it("should OR across base and joined table (postgres)", async () => {
      await testOrFilterAcrossTables(
        Alepha.create().with(AlephaOrmTestPostgres),
      );
    });
  });

  describe("getOne / findOne with joins", () => {
    it("should throw when not found via getOne (sqlite)", async () => {
      await testGetOneWithJoinThrowsWhenNotFound(
        Alepha.create({ env: { DATABASE_URL: "sqlite://:memory:" } }),
      );
    });
    it("should throw when not found via getOne (postgres)", async () => {
      await testGetOneWithJoinThrowsWhenNotFound(
        Alepha.create().with(AlephaOrmTestPostgres),
      );
    });

    it("should return undefined via findOne (sqlite)", async () => {
      await testFindOneWithJoinReturnsUndefined(
        Alepha.create({ env: { DATABASE_URL: "sqlite://:memory:" } }),
      );
    });
    it("should return undefined via findOne (postgres)", async () => {
      await testFindOneWithJoinReturnsUndefined(
        Alepha.create().with(AlephaOrmTestPostgres),
      );
    });
  });

  describe("operators on a joined column", () => {
    it("should filter with operators on joined table (sqlite)", async () => {
      await testMultipleOperatorsOnJoinedFilter(
        Alepha.create({ env: { DATABASE_URL: "sqlite://:memory:" } }),
      );
    });
    it("should filter with operators on joined table (postgres)", async () => {
      await testMultipleOperatorsOnJoinedFilter(
        Alepha.create().with(AlephaOrmTestPostgres),
      );
    });
  });

  describe("getById / findById with relations", () => {
    it("should eager-load relations on PK lookup (sqlite)", async () => {
      await testGetByIdWithRelations(
        Alepha.create({ env: { DATABASE_URL: "sqlite://:memory:" } }),
      );
    });
    it("should eager-load relations on PK lookup (postgres)", async () => {
      await testGetByIdWithRelations(
        Alepha.create().with(AlephaOrmTestPostgres),
      );
    });
  });
});
