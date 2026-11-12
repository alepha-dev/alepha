import { Alepha, AlephaError, z } from "alepha";
import { CliProvider } from "alepha/command";
import { $entity, $repository, DatabaseProvider, db } from "alepha/orm";
import {
  FileSystemProvider,
  MemoryFileSystemProvider,
  MemoryShellProvider,
  ShellProvider,
} from "alepha/system";
import { describe, it } from "vitest";

import { DbCommand } from "../commands/db.ts";
import { AlephaCliUtils } from "../services/AlephaCliUtils.ts";

class TestDbCommand extends DbCommand {
  public readonly testCheck = this.check;
  public readonly testCreate = this.create;
  public readonly testPush = this.push;
  public testFindUnmatchedCustomMigrations =
    this.findUnmatchedCustomMigrations.bind(this);
}

/**
 * Hands the command a container built in the spec instead of booting a real
 * project through Vite, as `DbCommand.spec.ts` does.
 */
class FakeCliUtils extends AlephaCliUtils {
  public userAlepha?: Alepha;

  public override async loadAlephaFromServerEntryFile(): Promise<Alepha> {
    if (!this.userAlepha) {
      throw new AlephaError("test did not provide a user container");
    }
    return this.userAlepha;
  }

  /**
   * The drizzle-kit config never reaches disk: the shell is a memory one.
   */
  public override async writeConfigFile(name: string): Promise<string> {
    return `/project/node_modules/.alepha/${name}`;
  }
}

const widgets = $entity({
  name: "widgets",
  schema: z.object({
    id: db.primaryKey(z.integer()),
    name: z.text(),
  }),
});

class App {
  public readonly widgets = $repository(widgets);
}

/**
 * Every app keeps `migrations/sqlite/` and `migrations/postgres/`, generated
 * and checked together whatever `DATABASE_URL` says (#Q3506).
 */
describe("alepha db migrations, both dialects", () => {
  const setup = async () => {
    const alepha = Alepha.create()
      .with({ provide: AlephaCliUtils, use: FakeCliUtils })
      .with({ provide: FileSystemProvider, use: MemoryFileSystemProvider })
      .with({ provide: ShellProvider, use: MemoryShellProvider });
    const fs = alepha.inject(MemoryFileSystemProvider);
    await fs.writeFile("/project/src/main.server.ts", "export default {};");

    const user = Alepha.create({ env: { DATABASE_URL: "sqlite://:memory:" } });
    user.inject(App);
    const utils = alepha.inject(FakeCliUtils);
    utils.userAlepha = user;

    return {
      fs,
      user,
      cli: alepha.inject(CliProvider),
      cmd: alepha.inject(TestDbCommand),
      shell: alepha.inject(MemoryShellProvider),
    };
  };

  /**
   * A migration folder whose snapshot is the app's current schema in that
   * dialect: what `create` leaves behind, so `check` sees no drift there.
   */
  const writeUpToDate = async (
    fs: MemoryFileSystemProvider,
    user: Alepha,
    dialect: "sqlite" | "postgresql",
  ) => {
    const { DrizzleKitProvider } = await import("alepha/orm");
    const { statements, snapshot } = await user
      .inject(DrizzleKitProvider)
      .generateMigration(user.inject(DatabaseProvider), undefined, {
        dialect,
      });
    const folder = dialect === "postgresql" ? "postgres" : "sqlite";
    const dir = `/project/migrations/${folder}/20261112000000_baseline`;
    await fs.writeFile(`${dir}/migration.sql`, statements.join("\n"));
    await fs.writeFile(`${dir}/snapshot.json`, JSON.stringify(snapshot));
  };

  describe("check", () => {
    it("fails on drift in either folder, and reports both before failing", async ({
      expect,
    }) => {
      const { cli, cmd } = await setup();

      await expect(
        cli.run(cmd.testCheck, { root: "/project", argv: "" }),
      ).rejects.toThrow(/migrations are not up to date \(sqlite, postgres\)/);
    });

    it("passes when both folders match the schema", async ({ expect }) => {
      const { cli, cmd, fs, user } = await setup();
      await writeUpToDate(fs, user, "sqlite");
      await writeUpToDate(fs, user, "postgresql");

      await expect(
        cli.run(cmd.testCheck, { root: "/project", argv: "" }),
      ).resolves.not.toThrow();
    });

    it("fails on the postgres folder alone when only it drifted", async ({
      expect,
    }) => {
      const { cli, cmd, fs, user } = await setup();
      await writeUpToDate(fs, user, "sqlite");
      await fs.writeFile(
        "/project/migrations/postgres/20261112000000_baseline/migration.sql",
        "SELECT 1;",
      );
      await fs.writeFile(
        "/project/migrations/postgres/20261112000000_baseline/snapshot.json",
        JSON.stringify(
          await (async () => {
            const { DrizzleKitProvider } = await import("alepha/orm");
            return (await user
              .inject(DrizzleKitProvider)
              .importDrizzleKit("postgresql")
              .generateDrizzleJson({})) as object;
          })(),
        ),
      );

      await expect(
        cli.run(cmd.testCheck, { root: "/project", argv: "" }),
      ).rejects.toThrow(/migrations are not up to date \(postgres\)\./);
    });

    it("names the missing baseline once, for an app with sqlite/ history only", async ({
      expect,
    }) => {
      const { cli, cmd, fs, user } = await setup();
      await writeUpToDate(fs, user, "sqlite");

      const run = cli.run(cmd.testCheck, { root: "/project", argv: "" });
      await expect(run).rejects.toThrow(
        "Database check failed: no postgres/ baseline: run alepha db baseline create --provider postgres.",
      );
    });

    it("checks one folder with --provider", async ({ expect }) => {
      const { cli, cmd, fs, user } = await setup();
      await writeUpToDate(fs, user, "sqlite");

      await expect(
        cli.run(cmd.testCheck, { root: "/project", argv: "--provider sqlite" }),
      ).resolves.not.toThrow();
    });
  });

  describe("custom migrations", () => {
    const header = "-- Custom SQL migration file, put your code below! --";

    it("refuses one whose twin is empty, and accepts it with a marker", async ({
      expect,
    }) => {
      const { cmd, fs } = await setup();
      await fs.writeFile(
        "/project/migrations/sqlite/20261112010000_backfill/migration.sql",
        `${header}\nUPDATE widgets SET name = lower(name);`,
      );
      await fs.writeFile(
        "/project/migrations/postgres/20261112010001_backfill/migration.sql",
        `${header}\n`,
      );

      expect(await cmd.testFindUnmatchedCustomMigrations("/project")).toEqual([
        "sqlite/20261112010000_backfill: postgres/20261112010001_backfill is empty",
      ]);

      await fs.writeFile(
        "/project/migrations/sqlite/20261112010000_backfill/migration.sql",
        `${header}\n-- alepha-sqlite-only: Postgres compares names case-insensitively already\nUPDATE widgets SET name = lower(name);`,
      );
      expect(await cmd.testFindUnmatchedCustomMigrations("/project")).toEqual(
        [],
      );
    });

    it("accepts twins that both carry SQL, and a pair left empty", async ({
      expect,
    }) => {
      const { cmd, fs } = await setup();
      for (const [folder, ts] of [
        ["sqlite", "20261112010000"],
        ["postgres", "20261112010001"],
      ]) {
        await fs.writeFile(
          `/project/migrations/${folder}/${ts}_backfill/migration.sql`,
          `${header}\nUPDATE widgets SET name = lower(name);`,
        );
        await fs.writeFile(
          `/project/migrations/${folder}/${ts}_placeholder/migration.sql`,
          `${header}\n`,
        );
      }
      expect(await cmd.testFindUnmatchedCustomMigrations("/project")).toEqual(
        [],
      );
    });

    it("refuses a custom migration with no twin at all", async ({ expect }) => {
      const { cmd, fs } = await setup();
      await fs.writeFile(
        "/project/migrations/postgres/20261112010000_jsonb_index/migration.sql",
        `${header}\nCREATE INDEX widgets_name_gin ON widgets USING gin (to_tsvector('simple', name));`,
      );
      expect(await cmd.testFindUnmatchedCustomMigrations("/project")).toEqual([
        "postgres/20261112010000_jsonb_index: sqlite/ has no twin",
      ]);
    });
  });

  describe("create, push and the URL", () => {
    it("generates both folders in one run, with no connection", async ({
      expect,
    }) => {
      const { cli, cmd, shell } = await setup();

      await cli.run(cmd.testCreate, { root: "/project", argv: "" });

      const generates = shell.calls.filter((it) =>
        it.command.includes(" generate --config="),
      );
      expect(generates).toHaveLength(2);
    });

    it("gives a custom migration one name in both folders", async ({
      expect,
    }) => {
      const { cli, cmd, shell } = await setup();

      await cli.run(cmd.testCreate, { root: "/project", argv: "--custom" });

      const names = shell.calls
        .filter((it) => it.command.includes(" generate --config="))
        .map((it) => /--name='([^']+)'/.exec(it.command)?.[1]);
      expect(names).toHaveLength(2);
      expect(names[0]).toMatch(/^custom_[0-9a-f]{8}$/);
      expect(names[1]).toBe(names[0]);
    });

    it("pushes to the one database DATABASE_URL names", async ({ expect }) => {
      const { cli, cmd, shell } = await setup();

      await cli.run(cmd.testPush, { root: "/project", argv: "" });

      const pushes = shell.calls.filter((it) =>
        it.command.includes(" push --config="),
      );
      expect(pushes).toHaveLength(1);
    });
  });
});
