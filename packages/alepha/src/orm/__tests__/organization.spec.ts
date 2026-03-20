import { Alepha } from "alepha";
import { describe, it } from "vitest";
import { AlephaOrmPostgres } from "../postgres/index.ts";
import {
  testAutoStampDoesNotOverrideExplicit,
  testAutoStampNullForMasterUser,
  testAutoStampOnCreate,
  testAutoStampOnCreateMany,
  testMasterUserSeesEverything,
  testNoUserSeesEverything,
  testOrgFilterOnDelete,
  testOrgFilterOnUpdateOne,
  testOrgUserSeesOwnAndGlobalRows,
} from "./organization-tests.ts";

describe("organization", () => {
  it("org user sees own + global rows (sqlite)", async () => {
    await testOrgUserSeesOwnAndGlobalRows(
      Alepha.create({ env: { DATABASE_URL: "sqlite://:memory:" } }),
    );
  });
  it("org user sees own + global rows (postgres)", async () => {
    await testOrgUserSeesOwnAndGlobalRows(
      Alepha.create().with(AlephaOrmPostgres),
    );
  });

  it("master user sees everything (sqlite)", async () => {
    await testMasterUserSeesEverything(
      Alepha.create({ env: { DATABASE_URL: "sqlite://:memory:" } }),
    );
  });
  it("master user sees everything (postgres)", async () => {
    await testMasterUserSeesEverything(Alepha.create().with(AlephaOrmPostgres));
  });

  it("no user sees everything (sqlite)", async () => {
    await testNoUserSeesEverything(
      Alepha.create({ env: { DATABASE_URL: "sqlite://:memory:" } }),
    );
  });
  it("no user sees everything (postgres)", async () => {
    await testNoUserSeesEverything(Alepha.create().with(AlephaOrmPostgres));
  });

  it("auto-stamps organization on create (sqlite)", async () => {
    await testAutoStampOnCreate(
      Alepha.create({ env: { DATABASE_URL: "sqlite://:memory:" } }),
    );
  });
  it("auto-stamps organization on create (postgres)", async () => {
    await testAutoStampOnCreate(Alepha.create().with(AlephaOrmPostgres));
  });

  it("auto-stamps null for master user (sqlite)", async () => {
    await testAutoStampNullForMasterUser(
      Alepha.create({ env: { DATABASE_URL: "sqlite://:memory:" } }),
    );
  });
  it("auto-stamps null for master user (postgres)", async () => {
    await testAutoStampNullForMasterUser(
      Alepha.create().with(AlephaOrmPostgres),
    );
  });

  it("does not override explicit organization (sqlite)", async () => {
    await testAutoStampDoesNotOverrideExplicit(
      Alepha.create({ env: { DATABASE_URL: "sqlite://:memory:" } }),
    );
  });
  it("does not override explicit organization (postgres)", async () => {
    await testAutoStampDoesNotOverrideExplicit(
      Alepha.create().with(AlephaOrmPostgres),
    );
  });

  it("auto-stamps on createMany (sqlite)", async () => {
    await testAutoStampOnCreateMany(
      Alepha.create({ env: { DATABASE_URL: "sqlite://:memory:" } }),
    );
  });
  it("auto-stamps on createMany (postgres)", async () => {
    await testAutoStampOnCreateMany(Alepha.create().with(AlephaOrmPostgres));
  });

  it("org filter on updateMany (sqlite)", async () => {
    await testOrgFilterOnUpdateOne(
      Alepha.create({ env: { DATABASE_URL: "sqlite://:memory:" } }),
    );
  });
  it("org filter on updateMany (postgres)", async () => {
    await testOrgFilterOnUpdateOne(Alepha.create().with(AlephaOrmPostgres));
  });

  it("org filter on delete (sqlite)", async () => {
    await testOrgFilterOnDelete(
      Alepha.create({ env: { DATABASE_URL: "sqlite://:memory:" } }),
    );
  });
  it("org filter on delete (postgres)", async () => {
    await testOrgFilterOnDelete(Alepha.create().with(AlephaOrmPostgres));
  });
});
