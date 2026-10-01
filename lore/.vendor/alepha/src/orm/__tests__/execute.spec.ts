import { Alepha } from "alepha";
import { describe, it } from "vitest";

import { AlephaOrmPostgres } from "../postgres/index.ts";
import { testExecuteBasicSqlQueries } from "./execute-tests.ts";

describe("execute", () => {
  it("should execute basic SQL queries (sqlite)", async () => {
    await testExecuteBasicSqlQueries(
      Alepha.create({ env: { DATABASE_URL: "sqlite://:memory:" } }),
    );
  });
  it("should execute basic SQL queries (postgres)", async () => {
    await testExecuteBasicSqlQueries(Alepha.create().with(AlephaOrmPostgres));
  });
});
