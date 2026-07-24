import { Alepha } from "alepha";
import { describe, it } from "vitest";
import { AlephaOrmPostgres } from "../postgres/index.ts";
import {
  testAggregateExcludesSoftDeleted,
  testForceDelete,
  testNoUpdateIfAlreadyDeleted,
  testSoftDeleteUpdatesInsteadOfDelete,
} from "./deletedAt-tests.ts";

describe("deletedAt", () => {
  it("should update instead of delete (sqlite)", async () => {
    await testSoftDeleteUpdatesInsteadOfDelete(
      Alepha.create({ env: { DATABASE_URL: "sqlite://:memory:" } }),
    );
  });
  it("should update instead of delete (postgres)", async () => {
    await testSoftDeleteUpdatesInsteadOfDelete(
      Alepha.create().with(AlephaOrmPostgres),
    );
  });

  it("should not update if deletedAt is already set (sqlite)", async () => {
    await testNoUpdateIfAlreadyDeleted(
      Alepha.create({ env: { DATABASE_URL: "sqlite://:memory:" } }),
    );
  });
  it("should not update if deletedAt is already set (postgres)", async () => {
    await testNoUpdateIfAlreadyDeleted(Alepha.create().with(AlephaOrmPostgres));
  });

  it("aggregate excludes soft-deleted rows (sqlite)", async () => {
    await testAggregateExcludesSoftDeleted(
      Alepha.create({ env: { DATABASE_URL: "sqlite://:memory:" } }),
    );
  });
  it("aggregate excludes soft-deleted rows (postgres)", async () => {
    await testAggregateExcludesSoftDeleted(
      Alepha.create().with(AlephaOrmPostgres),
    );
  });

  it("should force delete (sqlite)", async () => {
    await testForceDelete(
      Alepha.create({ env: { DATABASE_URL: "sqlite://:memory:" } }),
    );
  });
  it("should force delete (postgres)", async () => {
    await testForceDelete(Alepha.create().with(AlephaOrmPostgres));
  });
});
