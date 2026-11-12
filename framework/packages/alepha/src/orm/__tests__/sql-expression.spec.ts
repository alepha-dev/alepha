import { Alepha } from "alepha";
import { AlephaOrmTestPostgres } from "alepha/orm";
import { describe, it } from "vitest";

import {
  testAgo,
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
