import { Alepha } from "alepha";
import { describe, it } from "vitest";

import { DesktopDataDefaults } from "../DesktopDataDefaults.ts";

const key = "alepha.postgres.bun-sqlite.options";
const paths = { data: "/Users/a/Library/Application Support/dev.alepha.x" };

describe("DesktopDataDefaults", () => {
  const defaults = new DesktopDataDefaults();

  it("points the default SQLite connection at <data>/app.db when the app names no database", ({
    expect,
  }) => {
    const alepha = Alepha.create({ env: { DATABASE_URL: undefined } });
    defaults.apply(alepha, paths);
    expect(alepha.store.get(key as any)).toEqual({
      path: `${paths.data}/app.db`,
    });
  });

  it("leaves an explicit absolute DATABASE_URL, a Postgres URL, D1 and memory alone", ({
    expect,
  }) => {
    for (const url of [
      "sqlite:///tmp/x.db",
      "/tmp/y.db",
      "postgres://u@h/db",
      "d1://b:id",
      ":memory:",
    ]) {
      const alepha = Alepha.create({ env: { DATABASE_URL: url } });
      defaults.apply(alepha, paths);
      expect(alepha.store.get(key as any)).toBeUndefined();
    }
  });

  it("keeps a path the app gave the SQLite provider", ({ expect }) => {
    const alepha = Alepha.create({ env: { DATABASE_URL: undefined } });
    alepha.store.set(key as any, { path: "/opt/app/data.db" });
    defaults.apply(alepha, paths);
    expect(alepha.store.get(key as any)).toEqual({ path: "/opt/app/data.db" });
  });

  it("refuses relative writable paths with the reason", ({ expect }) => {
    for (const url of ["sqlite://app.db", "sqlite:data/app.db", "app.db"]) {
      const alepha = Alepha.create({ env: { DATABASE_URL: url } });
      expect(() => defaults.apply(alepha, paths)).toThrow(
        /relative path\. A desktop app's bundle is read-only/,
      );
    }
    const store = Alepha.create({ env: { DATABASE_URL: undefined } });
    store.store.set(key as any, { path: "data.db" });
    expect(() => defaults.apply(store, paths)).toThrow(
      /The SQLite path points at 'data\.db'/,
    );

    const secret = Alepha.create({ env: { APP_SECRET_FILE: "secret" } });
    expect(() => defaults.apply(secret, paths)).toThrow(
      /APP_SECRET_FILE 'secret' is relative/,
    );
  });

  it("accepts an absolute APP_SECRET_FILE", ({ expect }) => {
    const alepha = Alepha.create({
      env: { APP_SECRET_FILE: "/secure/secret", DATABASE_URL: undefined },
    });
    expect(() => defaults.apply(alepha, paths)).not.toThrow();
  });
});
