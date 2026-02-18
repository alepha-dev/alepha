import { Alepha } from "alepha";
import { describe, it } from "vitest";
import {
  testBypassImplicitTx,
  testComposeWithMiddleware,
  testDatabaseProviderTransactional,
  testNesting,
  testRollbackOnError,
  testWrapsInTransaction,
} from "./$transactional-tests.ts";

describe("$transactional", () => {
  it("should wrap handler in a database transaction (sqlite)", async () => {
    await testWrapsInTransaction(
      Alepha.create({ env: { DATABASE_URL: "sqlite://:memory:" } }),
    );
  });
  it("should wrap handler in a database transaction (postgres)", async () => {
    await testWrapsInTransaction(Alepha.create());
  });

  it("should rollback all operations on error (sqlite)", async () => {
    await testRollbackOnError(
      Alepha.create({ env: { DATABASE_URL: "sqlite://:memory:" } }),
    );
  });
  it("should rollback all operations on error (postgres)", async () => {
    await testRollbackOnError(Alepha.create());
  });

  it("should support nesting / reuse outer tx (sqlite)", async () => {
    await testNesting(
      Alepha.create({ env: { DATABASE_URL: "sqlite://:memory:" } }),
    );
  });
  it("should support nesting / reuse outer tx (postgres)", async () => {
    await testNesting(Alepha.create());
  });

  it("should compose with other middleware (sqlite)", async () => {
    await testComposeWithMiddleware(
      Alepha.create({ env: { DATABASE_URL: "sqlite://:memory:" } }),
    );
  });
  it("should compose with other middleware (postgres)", async () => {
    await testComposeWithMiddleware(Alepha.create());
  });

  it("should bypass implicit tx with tx: null (sqlite)", async () => {
    await testBypassImplicitTx(
      Alepha.create({ env: { DATABASE_URL: "sqlite://:memory:" } }),
    );
  });
  it("should bypass implicit tx with tx: null (postgres)", async () => {
    await testBypassImplicitTx(Alepha.create());
  });

  it("should work with DatabaseProvider.transactional() directly (sqlite)", async () => {
    await testDatabaseProviderTransactional(
      Alepha.create({ env: { DATABASE_URL: "sqlite://:memory:" } }),
    );
  });
  it("should work with DatabaseProvider.transactional() directly (postgres)", async () => {
    await testDatabaseProviderTransactional(Alepha.create());
  });
});
