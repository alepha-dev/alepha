import { Alepha } from "alepha";
import { describe, it } from "vitest";

import { AlephaOrmPostgres } from "../postgres/index.ts";
import {
  testBulkInsertsWithTimestamps,
  testTimestampFormats,
  testTimestampIndexes,
  testTimestamps,
} from "./timestamps-tests.ts";

describe("timestamps", () => {
  describe("createdAt/updatedAt", () => {
    it("should handle timestamps correctly (sqlite)", async () => {
      await testTimestamps(
        Alepha.create({ env: { DATABASE_URL: "sqlite://:memory:" } }),
      );
    });
    it("should handle timestamps correctly (postgres)", async () => {
      await testTimestamps(Alepha.create().with(AlephaOrmPostgres));
    });
  });

  describe("indexes", () => {
    it("should create proper indexes on timestamp fields (sqlite)", async () => {
      await testTimestampIndexes(
        Alepha.create({ env: { DATABASE_URL: "sqlite://:memory:" } }),
      );
    });
    it("should create proper indexes on timestamp fields (postgres)", async () => {
      await testTimestampIndexes(Alepha.create().with(AlephaOrmPostgres));
    });
  });

  describe("formats", () => {
    it("should handle timestamps with different formats (sqlite)", async () => {
      await testTimestampFormats(
        Alepha.create({ env: { DATABASE_URL: "sqlite://:memory:" } }),
      );
    });
    it("should handle timestamps with different formats (postgres)", async () => {
      await testTimestampFormats(Alepha.create().with(AlephaOrmPostgres));
    });
  });

  describe("bulk inserts", () => {
    it("should handle bulk inserts with timestamps (sqlite)", async () => {
      await testBulkInsertsWithTimestamps(
        Alepha.create({ env: { DATABASE_URL: "sqlite://:memory:" } }),
      );
    });
    it("should handle bulk inserts with timestamps (postgres)", async () => {
      await testBulkInsertsWithTimestamps(
        Alepha.create().with(AlephaOrmPostgres),
      );
    });
  });
});
