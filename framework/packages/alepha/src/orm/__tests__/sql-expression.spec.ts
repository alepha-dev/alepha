import { Alepha } from "alepha";
import { AlephaOrmTestPostgres } from "alepha/orm";
import { describe, it } from "vitest";

import {
  testAgo,
  testDateBucketsAreUtc,
  testDateColumnKeepsItsDay,
  testDateDay,
  testDateDiff,
  testDateWeek,
  testGreatestLeast,
  testJsonHelpers,
} from "./sql-expression-tests.ts";

describe("SqlExpressionProvider", () => {
  describe("dateDay", () => {
    it("should return YYYY-MM-DD text (sqlite)", async () => {
      await testDateDay(
        Alepha.create({ env: { DATABASE_URL: "sqlite://:memory:" } }),
      );
    });
    it("should return YYYY-MM-DD text (postgres)", async () => {
      await testDateDay(Alepha.create().with(AlephaOrmTestPostgres));
    });
  });

  describe("dateDay / dateHour / dateWeek time zone", () => {
    it("should bucket in UTC (sqlite)", async () => {
      await testDateBucketsAreUtc(
        Alepha.create({ env: { DATABASE_URL: "sqlite://:memory:" } }),
      );
    });
    it("should bucket in UTC under a session in another time zone (postgres)", async () => {
      await testDateBucketsAreUtc(Alepha.create().with(AlephaOrmTestPostgres));
    });
  });

  describe("a date column beside a timestamp", () => {
    it("should keep a date's day and read a timestamp in UTC under a session in another time zone (postgres)", async () => {
      await testDateColumnKeepsItsDay(
        Alepha.create().with(AlephaOrmTestPostgres),
      );
    });
  });

  describe("dateWeek", () => {
    it("should return ISO week labels (sqlite)", async () => {
      await testDateWeek(
        Alepha.create({ env: { DATABASE_URL: "sqlite://:memory:" } }),
      );
    });
    it("should return ISO week labels (postgres)", async () => {
      await testDateWeek(Alepha.create().with(AlephaOrmTestPostgres));
    });
  });

  describe("dateDiff", () => {
    it("should measure elapsed hours and skip NULLs (sqlite)", async () => {
      await testDateDiff(
        Alepha.create({ env: { DATABASE_URL: "sqlite://:memory:" } }),
      );
    });
    it("should measure elapsed hours and skip NULLs (postgres)", async () => {
      await testDateDiff(Alepha.create().with(AlephaOrmTestPostgres));
    });
  });

  describe("ago", () => {
    it("should bound a relative time window (sqlite)", async () => {
      await testAgo(
        Alepha.create({ env: { DATABASE_URL: "sqlite://:memory:" } }),
      );
    });
    it("should bound a relative time window (postgres)", async () => {
      await testAgo(Alepha.create().with(AlephaOrmTestPostgres));
    });
  });

  describe("greatest / least", () => {
    it("should pick across values and columns (sqlite)", async () => {
      await testGreatestLeast(
        Alepha.create({ env: { DATABASE_URL: "sqlite://:memory:" } }),
      );
    });
    it("should pick across values and columns (postgres)", async () => {
      await testGreatestLeast(Alepha.create().with(AlephaOrmTestPostgres));
    });
  });

  describe("jsonSet / jsonArrayAppend", () => {
    it("should set a path and append to an array (sqlite)", async () => {
      await testJsonHelpers(
        Alepha.create({ env: { DATABASE_URL: "sqlite://:memory:" } }),
      );
    });
    it("should set a path and append to an array (postgres)", async () => {
      await testJsonHelpers(Alepha.create().with(AlephaOrmTestPostgres));
    });
  });
});
