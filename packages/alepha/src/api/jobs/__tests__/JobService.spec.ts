import { Alepha } from "alepha";
import { AlephaOrmPostgres } from "alepha/orm/postgres";
import { describe, it } from "vitest";
import {
  testGetStatsEmpty,
  testGetStatsWithMixedStatuses,
} from "../services/JobService-tests.ts";

describe("JobService", () => {
  describe("getStats", () => {
    it("should return zeroes when no executions exist (sqlite)", async () => {
      await testGetStatsEmpty(
        Alepha.create({ env: { DATABASE_URL: "sqlite://:memory:" } }),
      );
    });
    it("should return zeroes when no executions exist (postgres)", async () => {
      await testGetStatsEmpty(Alepha.create().with(AlephaOrmPostgres));
    });

    it("should count executions by status (sqlite)", async () => {
      await testGetStatsWithMixedStatuses(
        Alepha.create({ env: { DATABASE_URL: "sqlite://:memory:" } }),
      );
    });
    it("should count executions by status (postgres)", async () => {
      await testGetStatsWithMixedStatuses(
        Alepha.create().with(AlephaOrmPostgres),
      );
    });
  });
});
