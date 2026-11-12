import { Alepha } from "alepha";
import {
  AlephaOrm,
  DatabaseProvider,
  DbUrlError,
  NodeSqliteProvider,
} from "alepha/orm";
import { describe, it } from "vitest";

import { CloudflareHyperdriveProvider } from "../providers/drivers/CloudflareHyperdriveProvider.ts";
import { NodePostgresProvider } from "../providers/drivers/NodePostgresProvider.ts";

describe("AlephaOrm: DATABASE_URL selects the provider", () => {
  const providerFor = (url: string | undefined) => {
    const alepha = Alepha.create({ env: { DATABASE_URL: url } }).with(
      AlephaOrm,
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

  it("selects SQLite when no URL is set", ({ expect }) => {
    expect(providerFor(undefined)).toBeInstanceOf(NodeSqliteProvider);
  });

  it("refuses an unknown scheme at register time", ({ expect }) => {
    expect(() => providerFor("mysql://u:p@localhost/app")).toThrow(DbUrlError);
  });
});
