import { Alepha } from "alepha";
import { describe, it } from "vitest";
import { AlephaOrmPostgres } from "../postgres/index.ts";
import {
  testBypassImplicitTx,
  testComposeWithMiddleware,
  testConcurrentTransactionals,
  testDatabaseProviderTransactional,
  testNesting,
  testRepositoryTransactionAsyncRollback,
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
    await testWrapsInTransaction(Alepha.create().with(AlephaOrmPostgres));
  });

  it("should rollback all operations on error (sqlite)", async () => {
    await testRollbackOnError(
      Alepha.create({ env: { DATABASE_URL: "sqlite://:memory:" } }),
    );
  });
  it("should rollback all operations on error (postgres)", async () => {
    await testRollbackOnError(Alepha.create().with(AlephaOrmPostgres));
  });

  it("should support nesting / reuse outer tx (sqlite)", async () => {
    await testNesting(
      Alepha.create({ env: { DATABASE_URL: "sqlite://:memory:" } }),
    );
  });
  it("should support nesting / reuse outer tx (postgres)", async () => {
    await testNesting(Alepha.create().with(AlephaOrmPostgres));
  });

  it("should compose with other middleware (sqlite)", async () => {
    await testComposeWithMiddleware(
      Alepha.create({ env: { DATABASE_URL: "sqlite://:memory:" } }),
    );
  });
  it("should compose with other middleware (postgres)", async () => {
    await testComposeWithMiddleware(Alepha.create().with(AlephaOrmPostgres));
  });

  // SQLite uses a single connection — writes inside a transaction always participate,
  // so tx:null cannot bypass the active transaction like PostgreSQL can.
  it.skip("should bypass implicit tx with tx: null (sqlite)", async () => {
    await testBypassImplicitTx(
      Alepha.create({ env: { DATABASE_URL: "sqlite://:memory:" } }),
    );
  });
  it("should bypass implicit tx with tx: null (postgres)", async () => {
    await testBypassImplicitTx(Alepha.create().with(AlephaOrmPostgres));
  });

  it("Repository.transaction rolls back async work (sqlite)", async () => {
    await testRepositoryTransactionAsyncRollback(
      Alepha.create({ env: { DATABASE_URL: "sqlite://:memory:" } }),
    );
  });
  it("Repository.transaction rolls back async work (postgres)", async () => {
    await testRepositoryTransactionAsyncRollback(
      Alepha.create().with(AlephaOrmPostgres),
    );
  });

  it("concurrent transactional blocks are serialized (sqlite)", async () => {
    await testConcurrentTransactionals(
      Alepha.create({ env: { DATABASE_URL: "sqlite://:memory:" } }),
    );
  });
  it("concurrent transactional blocks are serialized (postgres)", async () => {
    await testConcurrentTransactionals(Alepha.create().with(AlephaOrmPostgres));
  });

  it("should work with DatabaseProvider.transactional() directly (sqlite)", async () => {
    await testDatabaseProviderTransactional(
      Alepha.create({ env: { DATABASE_URL: "sqlite://:memory:" } }),
    );
  });
  it("should work with DatabaseProvider.transactional() directly (postgres)", async () => {
    await testDatabaseProviderTransactional(
      Alepha.create().with(AlephaOrmPostgres),
    );
  });
});
