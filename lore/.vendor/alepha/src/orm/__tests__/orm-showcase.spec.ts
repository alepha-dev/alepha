import { Alepha } from "alepha";
import { describe, it } from "vitest";

import { AlephaOrmPostgres } from "../postgres/index.ts";
import {
  testCombinedFilters,
  testEmptyResultWithJoins,
  testFilterOnJoinedTable,
  testFindOneWithJoinReturnsUndefined,
  testGetByIdWithRelations,
  testGetOneWithJoinThrowsWhenNotFound,
  testInnerJoinExcludesNulls,
  testJoinWithOffset,
  testJoinWithOrderByAndLimit,
  testLeftJoinPlayerWithTeam,
  testLeftJoinReturnsUndefinedWhenFkNull,
  testMultipleOperatorsOnJoinedFilter,
  testOrFilterAcrossTables,
  testPaginationWithJoins,
} from "./orm-showcase-tests.ts";

describe("orm showcase: entities + joins", () => {
  describe("basic left join", () => {
    it("should join player with team (sqlite)", async () => {
      await testLeftJoinPlayerWithTeam(
        Alepha.create({ env: { DATABASE_URL: "sqlite://:memory:" } }),
      );
    });
    it("should join player with team (postgres)", async () => {
      await testLeftJoinPlayerWithTeam(Alepha.create().with(AlephaOrmPostgres));
    });
  });

  describe("left join with null FK", () => {
    it("should return undefined when FK is null (sqlite)", async () => {
      await testLeftJoinReturnsUndefinedWhenFkNull(
        Alepha.create({ env: { DATABASE_URL: "sqlite://:memory:" } }),
      );
    });
    it("should return undefined when FK is null (postgres)", async () => {
      await testLeftJoinReturnsUndefinedWhenFkNull(
        Alepha.create().with(AlephaOrmPostgres),
      );
    });
  });

  describe("inner join", () => {
    it("should exclude rows without match (sqlite)", async () => {
      await testInnerJoinExcludesNulls(
        Alepha.create({ env: { DATABASE_URL: "sqlite://:memory:" } }),
      );
    });
    it("should exclude rows without match (postgres)", async () => {
      await testInnerJoinExcludesNulls(Alepha.create().with(AlephaOrmPostgres));
    });
  });

  describe("filter on joined table", () => {
    it("should filter by joined table column (sqlite)", async () => {
      await testFilterOnJoinedTable(
        Alepha.create({ env: { DATABASE_URL: "sqlite://:memory:" } }),
      );
    });
    it("should filter by joined table column (postgres)", async () => {
      await testFilterOnJoinedTable(Alepha.create().with(AlephaOrmPostgres));
    });
  });

  describe("combined base + join filters", () => {
    it("should combine base and join table filters (sqlite)", async () => {
      await testCombinedFilters(
        Alepha.create({ env: { DATABASE_URL: "sqlite://:memory:" } }),
      );
    });
    it("should combine base and join table filters (postgres)", async () => {
      await testCombinedFilters(Alepha.create().with(AlephaOrmPostgres));
    });
  });

  describe("orderBy + limit with joins", () => {
    it("should order and limit with joins (sqlite)", async () => {
      await testJoinWithOrderByAndLimit(
        Alepha.create({ env: { DATABASE_URL: "sqlite://:memory:" } }),
      );
    });
    it("should order and limit with joins (postgres)", async () => {
      await testJoinWithOrderByAndLimit(
        Alepha.create().with(AlephaOrmPostgres),
      );
    });
  });

  describe("pagination with joins", () => {
    it("should paginate with joins (sqlite)", async () => {
      await testPaginationWithJoins(
        Alepha.create({ env: { DATABASE_URL: "sqlite://:memory:" } }),
      );
    });
    it("should paginate with joins (postgres)", async () => {
      await testPaginationWithJoins(Alepha.create().with(AlephaOrmPostgres));
    });
  });

  describe("OR filter across tables", () => {
    it("should OR across base and joined table (sqlite)", async () => {
      await testOrFilterAcrossTables(
        Alepha.create({ env: { DATABASE_URL: "sqlite://:memory:" } }),
      );
    });
    it("should OR across base and joined table (postgres)", async () => {
      await testOrFilterAcrossTables(Alepha.create().with(AlephaOrmPostgres));
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
        Alepha.create().with(AlephaOrmPostgres),
      );
    });

    it("should return undefined via findOne (sqlite)", async () => {
      await testFindOneWithJoinReturnsUndefined(
        Alepha.create({ env: { DATABASE_URL: "sqlite://:memory:" } }),
      );
    });
    it("should return undefined via findOne (postgres)", async () => {
      await testFindOneWithJoinReturnsUndefined(
        Alepha.create().with(AlephaOrmPostgres),
      );
    });
  });

  describe("edge cases", () => {
    it("should return empty array when no matches (sqlite)", async () => {
      await testEmptyResultWithJoins(
        Alepha.create({ env: { DATABASE_URL: "sqlite://:memory:" } }),
      );
    });
    it("should return empty array when no matches (postgres)", async () => {
      await testEmptyResultWithJoins(Alepha.create().with(AlephaOrmPostgres));
    });

    it("should filter with operators on joined table (sqlite)", async () => {
      await testMultipleOperatorsOnJoinedFilter(
        Alepha.create({ env: { DATABASE_URL: "sqlite://:memory:" } }),
      );
    });
    it("should filter with operators on joined table (postgres)", async () => {
      await testMultipleOperatorsOnJoinedFilter(
        Alepha.create().with(AlephaOrmPostgres),
      );
    });

    it("should handle offset with inner join (sqlite)", async () => {
      await testJoinWithOffset(
        Alepha.create({ env: { DATABASE_URL: "sqlite://:memory:" } }),
      );
    });
    it("should handle offset with inner join (postgres)", async () => {
      await testJoinWithOffset(Alepha.create().with(AlephaOrmPostgres));
    });
  });

  describe("getById / findById with relations", () => {
    it("should eager-load relations on PK lookup (sqlite)", async () => {
      await testGetByIdWithRelations(
        Alepha.create({ env: { DATABASE_URL: "sqlite://:memory:" } }),
      );
    });
    it("should eager-load relations on PK lookup (postgres)", async () => {
      await testGetByIdWithRelations(Alepha.create().with(AlephaOrmPostgres));
    });
  });
});
