import { Alepha } from "alepha";
import { describe, it } from "vitest";

import { AlephaOrmPostgres } from "../postgres/index.ts";
import {
  testAgo,
  testDateDay,
  testDateDiff,
  testDateWeek,
} from "./sql-expression-tests.ts";

describe("SqlExpressionProvider", () => {
  describe("dateDay", () => {
    it("should return YYYY-MM-DD text (sqlite)", async () => {
      await testDateDay(
        Alepha.create({ env: { DATABASE_URL: "sqlite://:memory:" } }),
      );
    });
    it("should return YYYY-MM-DD text (postgres)", async () => {
      await testDateDay(Alepha.create().with(AlephaOrmPostgres));
    });
  });

  describe("dateWeek", () => {
    it("should return ISO week labels (sqlite)", async () => {
      await testDateWeek(
        Alepha.create({ env: { DATABASE_URL: "sqlite://:memory:" } }),
      );
    });
    it("should return ISO week labels (postgres)", async () => {
      await testDateWeek(Alepha.create().with(AlephaOrmPostgres));
    });
  });

  describe("dateDiff", () => {
    it("should measure elapsed hours and skip NULLs (sqlite)", async () => {
      await testDateDiff(
        Alepha.create({ env: { DATABASE_URL: "sqlite://:memory:" } }),
      );
    });
    it("should measure elapsed hours and skip NULLs (postgres)", async () => {
      await testDateDiff(Alepha.create().with(AlephaOrmPostgres));
    });
  });

  describe("ago", () => {
    it("should bound a relative time window (sqlite)", async () => {
      await testAgo(
        Alepha.create({ env: { DATABASE_URL: "sqlite://:memory:" } }),
      );
    });
    it("should bound a relative time window (postgres)", async () => {
      await testAgo(Alepha.create().with(AlephaOrmPostgres));
    });
  });
});
