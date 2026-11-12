import { Alepha } from "alepha";
import { DatabaseProvider, DbUrlError, NodeSqliteProvider } from "alepha/orm";
import { describe, it } from "vitest";

import { AlephaOrmPostgres } from "../index.ts";
import { CloudflareHyperdriveProvider } from "../providers/CloudflareHyperdriveProvider.ts";
import { NodePostgresProvider } from "../providers/NodePostgresProvider.ts";

describe("DATABASE_URL selects the provider", () => {
  const providerFor = (url: string | undefined) => {
    const alepha = Alepha.create({ env: { DATABASE_URL: url } }).with(
      AlephaOrmPostgres,
    );
    return alepha.inject(DatabaseProvider);
  };

  it("selects Postgres for postgres:// and postgresql:// alike", ({
    expect,
  }) => {
    expect(providerFor("postgres://u:p@localhost:5432/app")).toBeInstanceOf(
      NodePostgresProvider,
    );
    expect(providerFor("postgresql://u:p@localhost:5432/app")).toBeInstanceOf(
      NodePostgresProvider,
    );
  });

  it("selects Hyperdrive for hyperdrive:// and SQLite for a path", ({
    expect,
  }) => {
    expect(providerFor("hyperdrive://HYPERDRIVE")).toBeInstanceOf(
      CloudflareHyperdriveProvider,
    );
    expect(providerFor("sqlite://:memory:")).toBeInstanceOf(NodeSqliteProvider);
  });

  it("refuses an unknown scheme at register time", ({ expect }) => {
    expect(() => providerFor("mysql://u:p@localhost/app")).toThrow(DbUrlError);
  });
});
