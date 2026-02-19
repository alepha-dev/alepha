import { Alepha } from "alepha";
import { describe, it } from "vitest";
import { AlephaOrmPostgres } from "../postgres/index.ts";
import {
  testDateComparisonsInComplexQueries,
  testDateEncodingWithNotInArray,
  testDateFiltersWithDayjs,
  testMixedDateFormats,
  testNullDateValues,
} from "./query-date-encoding-tests.ts";

describe("query-date-encoding", () => {
  describe("date filters with Dayjs objects", () => {
    it("should handle date filters with Dayjs objects (sqlite)", async () => {
      await testDateFiltersWithDayjs(
        Alepha.create({ env: { DATABASE_URL: "sqlite://:memory:" } }),
      );
    });
    it("should handle date filters with Dayjs objects (postgres)", async () => {
      await testDateFiltersWithDayjs(Alepha.create().with(AlephaOrmPostgres));
    });
  });

  describe("mixed date formats", () => {
    it("should handle mixed date formats (sqlite)", async () => {
      await testMixedDateFormats(
        Alepha.create({ env: { DATABASE_URL: "sqlite://:memory:" } }),
      );
    });
    it("should handle mixed date formats (postgres)", async () => {
      await testMixedDateFormats(Alepha.create().with(AlephaOrmPostgres));
    });
  });

  describe("complex queries", () => {
    it("should handle date comparisons in complex queries (sqlite)", async () => {
      await testDateComparisonsInComplexQueries(
        Alepha.create({ env: { DATABASE_URL: "sqlite://:memory:" } }),
      );
    });
    it("should handle date comparisons in complex queries (postgres)", async () => {
      await testDateComparisonsInComplexQueries(
        Alepha.create().with(AlephaOrmPostgres),
      );
    });
  });

  describe("null date values", () => {
    it("should handle null date values (sqlite)", async () => {
      await testNullDateValues(
        Alepha.create({ env: { DATABASE_URL: "sqlite://:memory:" } }),
      );
    });
    it("should handle null date values (postgres)", async () => {
      await testNullDateValues(Alepha.create().with(AlephaOrmPostgres));
    });
  });

  describe("notInArray with dates", () => {
    it("should handle date encoding with notInArray (sqlite)", async () => {
      await testDateEncodingWithNotInArray(
        Alepha.create({ env: { DATABASE_URL: "sqlite://:memory:" } }),
      );
    });
    it("should handle date encoding with notInArray (postgres)", async () => {
      await testDateEncodingWithNotInArray(
        Alepha.create().with(AlephaOrmPostgres),
      );
    });
  });
});
