import { Alepha } from "alepha";
import { describe, it } from "vitest";
import { AlephaOrmPostgres } from "../postgres/index.ts";
import {
  testCombineBaseAndJoinedTableFilters,
  testComplexWhereWithMultipleJoinFilters,
  testDeeplyNestedSelfReference,
  testEmptyResultSetWithJoins,
  testFilterByJoinedTableColumn,
  testFilterByNestedJoinedTableColumn,
  testFilterBySelfReferencingJoin,
  testFindMultipleWithJoins,
  testFindWithJoinsAndLimit,
  testFindWithJoinsAndOffset,
  testInnerJoin,
  testInnerJoinNoMatchingRecords,
  testJoinWithNullForeignKey,
  testLeftJoinSqlWrapper,
  testLeftJoinTupleSyntax,
  testMultipleJoins,
  testMultipleJoinsWithDifferentTypes,
  testMultipleNestedJoinsWithManagerAndCities,
  testNestedJoin2LevelsPostAuthorCity,
  testNestedJoin2LevelsUserCityCountry,
  testNestedJoin3LevelsPostAuthorCityCountry,
  testPaginateWithJoins,
  testPaginateWithNestedJoins,
  testPostWithAuthorCommentsAndCommentAuthors,
  testSameTableJoinedMultipleTimesWithAliases,
  testSelfReferencingJoinWithManager,
  testSelfReferencingJoinWithoutManager,
  testSimpleLeftJoin,
} from "./joins-tests.ts";

describe("joins", () => {
  describe("basic joins", () => {
    it("should do simple left join (sqlite)", async () => {
      await testSimpleLeftJoin(
        Alepha.create({ env: { DATABASE_URL: "sqlite://:memory:" } }),
      );
    });
    it("should do simple left join (postgres)", async () => {
      await testSimpleLeftJoin(Alepha.create().with(AlephaOrmPostgres));
    });

    it("should do left join with tuple syntax (sqlite)", async () => {
      await testLeftJoinTupleSyntax(
        Alepha.create({ env: { DATABASE_URL: "sqlite://:memory:" } }),
      );
    });
    it("should do left join with tuple syntax (postgres)", async () => {
      await testLeftJoinTupleSyntax(Alepha.create().with(AlephaOrmPostgres));
    });

    // SQLite: entity column refs (users.cols.id) passed to drizzle's sql`` tag become
    // bind parameters. node:sqlite interprets objects with a `name` property as named
    // parameter dictionaries, causing "Unknown named parameter" errors. Use tuple syntax instead.
    it.skip("should do left join with sql wrapper (sqlite)", async () => {
      await testLeftJoinSqlWrapper(
        Alepha.create({ env: { DATABASE_URL: "sqlite://:memory:" } }),
      );
    });
    it("should do left join with sql wrapper (postgres)", async () => {
      await testLeftJoinSqlWrapper(Alepha.create().with(AlephaOrmPostgres));
    });

    it("should do inner join (sqlite)", async () => {
      await testInnerJoin(
        Alepha.create({ env: { DATABASE_URL: "sqlite://:memory:" } }),
      );
    });
    it("should do inner join (postgres)", async () => {
      await testInnerJoin(Alepha.create().with(AlephaOrmPostgres));
    });
  });

  describe("self-referencing joins", () => {
    it("should join user with manager (sqlite)", async () => {
      await testSelfReferencingJoinWithManager(
        Alepha.create({ env: { DATABASE_URL: "sqlite://:memory:" } }),
      );
    });
    it("should join user with manager (postgres)", async () => {
      await testSelfReferencingJoinWithManager(
        Alepha.create().with(AlephaOrmPostgres),
      );
    });

    it("should find users without manager (sqlite)", async () => {
      await testSelfReferencingJoinWithoutManager(
        Alepha.create({ env: { DATABASE_URL: "sqlite://:memory:" } }),
      );
    });
    it("should find users without manager (postgres)", async () => {
      await testSelfReferencingJoinWithoutManager(
        Alepha.create().with(AlephaOrmPostgres),
      );
    });
  });

  describe("multiple joins", () => {
    it("should join user with profile and city (sqlite)", async () => {
      await testMultipleJoins(
        Alepha.create({ env: { DATABASE_URL: "sqlite://:memory:" } }),
      );
    });
    it("should join user with profile and city (postgres)", async () => {
      await testMultipleJoins(Alepha.create().with(AlephaOrmPostgres));
    });

    it("should support multiple joins with different types (sqlite)", async () => {
      await testMultipleJoinsWithDifferentTypes(
        Alepha.create({ env: { DATABASE_URL: "sqlite://:memory:" } }),
      );
    });
    it("should support multiple joins with different types (postgres)", async () => {
      await testMultipleJoinsWithDifferentTypes(
        Alepha.create().with(AlephaOrmPostgres),
      );
    });
  });

  describe("nested joins", () => {
    it("should nest 2 levels: user -> city -> country (sqlite)", async () => {
      await testNestedJoin2LevelsUserCityCountry(
        Alepha.create({ env: { DATABASE_URL: "sqlite://:memory:" } }),
      );
    });
    it("should nest 2 levels: user -> city -> country (postgres)", async () => {
      await testNestedJoin2LevelsUserCityCountry(
        Alepha.create().with(AlephaOrmPostgres),
      );
    });

    it("should nest 2 levels: post -> author -> city (sqlite)", async () => {
      await testNestedJoin2LevelsPostAuthorCity(
        Alepha.create({ env: { DATABASE_URL: "sqlite://:memory:" } }),
      );
    });
    it("should nest 2 levels: post -> author -> city (postgres)", async () => {
      await testNestedJoin2LevelsPostAuthorCity(
        Alepha.create().with(AlephaOrmPostgres),
      );
    });

    it("should handle multiple nested joins with manager and cities (sqlite)", async () => {
      await testMultipleNestedJoinsWithManagerAndCities(
        Alepha.create({ env: { DATABASE_URL: "sqlite://:memory:" } }),
      );
    });
    it("should handle multiple nested joins with manager and cities (postgres)", async () => {
      await testMultipleNestedJoinsWithManagerAndCities(
        Alepha.create().with(AlephaOrmPostgres),
      );
    });

    it("should nest 3 levels: post -> author -> city -> country (sqlite)", async () => {
      await testNestedJoin3LevelsPostAuthorCityCountry(
        Alepha.create({ env: { DATABASE_URL: "sqlite://:memory:" } }),
      );
    });
    it("should nest 3 levels: post -> author -> city -> country (postgres)", async () => {
      await testNestedJoin3LevelsPostAuthorCityCountry(
        Alepha.create().with(AlephaOrmPostgres),
      );
    });

    it("should handle deeply nested self-reference: user -> manager -> manager (sqlite)", async () => {
      await testDeeplyNestedSelfReference(
        Alepha.create({ env: { DATABASE_URL: "sqlite://:memory:" } }),
      );
    });
    it("should handle deeply nested self-reference: user -> manager -> manager (postgres)", async () => {
      await testDeeplyNestedSelfReference(
        Alepha.create().with(AlephaOrmPostgres),
      );
    });
  });

  describe("where clause on joined tables", () => {
    it("should filter by joined table column (sqlite)", async () => {
      await testFilterByJoinedTableColumn(
        Alepha.create({ env: { DATABASE_URL: "sqlite://:memory:" } }),
      );
    });
    it("should filter by joined table column (postgres)", async () => {
      await testFilterByJoinedTableColumn(
        Alepha.create().with(AlephaOrmPostgres),
      );
    });

    it("should filter by nested joined table column (sqlite)", async () => {
      await testFilterByNestedJoinedTableColumn(
        Alepha.create({ env: { DATABASE_URL: "sqlite://:memory:" } }),
      );
    });
    it("should filter by nested joined table column (postgres)", async () => {
      await testFilterByNestedJoinedTableColumn(
        Alepha.create().with(AlephaOrmPostgres),
      );
    });

    it("should combine base and joined table filters (sqlite)", async () => {
      await testCombineBaseAndJoinedTableFilters(
        Alepha.create({ env: { DATABASE_URL: "sqlite://:memory:" } }),
      );
    });
    it("should combine base and joined table filters (postgres)", async () => {
      await testCombineBaseAndJoinedTableFilters(
        Alepha.create().with(AlephaOrmPostgres),
      );
    });

    it("should filter by self-referencing join (sqlite)", async () => {
      await testFilterBySelfReferencingJoin(
        Alepha.create({ env: { DATABASE_URL: "sqlite://:memory:" } }),
      );
    });
    it("should filter by self-referencing join (postgres)", async () => {
      await testFilterBySelfReferencingJoin(
        Alepha.create().with(AlephaOrmPostgres),
      );
    });
  });

  describe("find multiple with joins", () => {
    it("should find multiple entities with joins (sqlite)", async () => {
      await testFindMultipleWithJoins(
        Alepha.create({ env: { DATABASE_URL: "sqlite://:memory:" } }),
      );
    });
    it("should find multiple entities with joins (postgres)", async () => {
      await testFindMultipleWithJoins(Alepha.create().with(AlephaOrmPostgres));
    });

    it("should find with joins and limit (sqlite)", async () => {
      await testFindWithJoinsAndLimit(
        Alepha.create({ env: { DATABASE_URL: "sqlite://:memory:" } }),
      );
    });
    it("should find with joins and limit (postgres)", async () => {
      await testFindWithJoinsAndLimit(Alepha.create().with(AlephaOrmPostgres));
    });

    it("should find with joins and offset (sqlite)", async () => {
      await testFindWithJoinsAndOffset(
        Alepha.create({ env: { DATABASE_URL: "sqlite://:memory:" } }),
      );
    });
    it("should find with joins and offset (postgres)", async () => {
      await testFindWithJoinsAndOffset(Alepha.create().with(AlephaOrmPostgres));
    });
  });

  describe("complex scenarios", () => {
    it("should handle post with author, comments, and comment authors (sqlite)", async () => {
      await testPostWithAuthorCommentsAndCommentAuthors(
        Alepha.create({ env: { DATABASE_URL: "sqlite://:memory:" } }),
      );
    });
    it("should handle post with author, comments, and comment authors (postgres)", async () => {
      await testPostWithAuthorCommentsAndCommentAuthors(
        Alepha.create().with(AlephaOrmPostgres),
      );
    });

    it("should handle join with null foreign key (sqlite)", async () => {
      await testJoinWithNullForeignKey(
        Alepha.create({ env: { DATABASE_URL: "sqlite://:memory:" } }),
      );
    });
    it("should handle join with null foreign key (postgres)", async () => {
      await testJoinWithNullForeignKey(Alepha.create().with(AlephaOrmPostgres));
    });

    it("should handle complex where with multiple join filters and operators (sqlite)", async () => {
      await testComplexWhereWithMultipleJoinFilters(
        Alepha.create({ env: { DATABASE_URL: "sqlite://:memory:" } }),
      );
    });
    it("should handle complex where with multiple join filters and operators (postgres)", async () => {
      await testComplexWhereWithMultipleJoinFilters(
        Alepha.create().with(AlephaOrmPostgres),
      );
    });
  });

  describe("pagination with joins", () => {
    it("should paginate with joins (sqlite)", async () => {
      await testPaginateWithJoins(
        Alepha.create({ env: { DATABASE_URL: "sqlite://:memory:" } }),
      );
    });
    it("should paginate with joins (postgres)", async () => {
      await testPaginateWithJoins(Alepha.create().with(AlephaOrmPostgres));
    });

    it("should paginate with nested joins (sqlite)", async () => {
      await testPaginateWithNestedJoins(
        Alepha.create({ env: { DATABASE_URL: "sqlite://:memory:" } }),
      );
    });
    it("should paginate with nested joins (postgres)", async () => {
      await testPaginateWithNestedJoins(
        Alepha.create().with(AlephaOrmPostgres),
      );
    });
  });

  describe("edge cases", () => {
    it("should return empty result for inner join with no matching records (sqlite)", async () => {
      await testInnerJoinNoMatchingRecords(
        Alepha.create({ env: { DATABASE_URL: "sqlite://:memory:" } }),
      );
    });
    it("should return empty result for inner join with no matching records (postgres)", async () => {
      await testInnerJoinNoMatchingRecords(
        Alepha.create().with(AlephaOrmPostgres),
      );
    });

    it("should join same table multiple times with aliases (sqlite)", async () => {
      await testSameTableJoinedMultipleTimesWithAliases(
        Alepha.create({ env: { DATABASE_URL: "sqlite://:memory:" } }),
      );
    });
    it("should join same table multiple times with aliases (postgres)", async () => {
      await testSameTableJoinedMultipleTimesWithAliases(
        Alepha.create().with(AlephaOrmPostgres),
      );
    });

    it("should return empty result set with joins (sqlite)", async () => {
      await testEmptyResultSetWithJoins(
        Alepha.create({ env: { DATABASE_URL: "sqlite://:memory:" } }),
      );
    });
    it("should return empty result set with joins (postgres)", async () => {
      await testEmptyResultSetWithJoins(
        Alepha.create().with(AlephaOrmPostgres),
      );
    });
  });
});
