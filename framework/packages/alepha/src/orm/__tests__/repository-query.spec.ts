import { Alepha } from "alepha";
import { AlephaOrmTestPostgres } from "alepha/orm";
import { describe, it } from "vitest";

import { testQueryBasicSql } from "./repository-query-tests.ts";

describe("Repository.query", () => {
  it("should run basic SQL queries (sqlite)", async () => {
    await testQueryBasicSql(
      Alepha.create({ env: { DATABASE_URL: "sqlite://:memory:" } }),
    );
  });
  it("should run basic SQL queries (postgres)", async () => {
    await testQueryBasicSql(Alepha.create().with(AlephaOrmTestPostgres));
  });
});
