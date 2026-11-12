import { Alepha } from "alepha";
import { AlephaOrmTestPostgres } from "alepha/orm";
import { describe, it } from "vitest";

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
      Alepha.create().with(AlephaOrmTestPostgres),
    );
  });

  it("should not update if deletedAt is already set (sqlite)", async () => {
    await testNoUpdateIfAlreadyDeleted(
      Alepha.create({ env: { DATABASE_URL: "sqlite://:memory:" } }),
    );
  });
  it("should not update if deletedAt is already set (postgres)", async () => {
    await testNoUpdateIfAlreadyDeleted(
      Alepha.create().with(AlephaOrmTestPostgres),
    );
  });

  it("aggregate excludes soft-deleted rows (sqlite)", async () => {
    await testAggregateExcludesSoftDeleted(
      Alepha.create({ env: { DATABASE_URL: "sqlite://:memory:" } }),
    );
  });
  it("aggregate excludes soft-deleted rows (postgres)", async () => {
    await testAggregateExcludesSoftDeleted(
      Alepha.create().with(AlephaOrmTestPostgres),
    );
  });

  it("should force delete (sqlite)", async () => {
    await testForceDelete(
      Alepha.create({ env: { DATABASE_URL: "sqlite://:memory:" } }),
    );
  });
  it("should force delete (postgres)", async () => {
    await testForceDelete(Alepha.create().with(AlephaOrmTestPostgres));
  });
});
