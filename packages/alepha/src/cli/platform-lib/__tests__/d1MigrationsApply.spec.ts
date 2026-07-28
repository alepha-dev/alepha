import { Alepha } from "alepha";
import { describe, it } from "vitest";
import { WranglerApi } from "../services/WranglerApi.ts";

/**
 * D1 migrations must NOT go through `wrangler d1 migrations apply`.
 *
 * That command runs each migration inside a transaction — its own help
 * says "this migration will be rolled back" on error — and SQLite
 * **ignores `PRAGMA foreign_keys` inside a transaction**. drizzle-kit
 * opens every generated table-rebuild with `PRAGMA foreign_keys=OFF`
 * precisely so the `DROP TABLE` does not cascade, so under
 * `migrations apply` that pragma is void, constraints stay live, and the
 * implicit `DELETE FROM` behind `DROP TABLE` takes every child row with
 * it. The migration then reports success.
 *
 * Measured against a real D1, same migrations and same database:
 *   wrangler d1 migrations apply  ->  0 of 5 child rows survive
 *   wrangler d1 execute --file    ->  5 of 5 survive
 *
 * It destroyed 2434 rows across five tables in a production deploy before
 * being caught, so this test asserts the command choice directly rather
 * than trusting a comment.
 */
describe("d1MigrationsApply", () => {
  const capture = async (files: string[]) => {
    const commands: string[] = [];

    class FakeShell {
      async run(command: string) {
        commands.push(command);
        // The applied-migrations lookup expects JSON; everything else can
        // return empty.
        if (command.includes("SELECT name FROM d1_migrations")) {
          return JSON.stringify([{ results: [] }]);
        }
        return "";
      }
    }
    class FakeFs {
      join(...parts: string[]) {
        return parts.join("/");
      }
      async exists() {
        return true;
      }
      async ls() {
        return files;
      }
    }

    const alepha = Alepha.create();
    const api = alepha.inject(WranglerApi);
    // Swap the collaborators the method actually uses.
    Object.assign(api as unknown as Record<string, unknown>, {
      shell: new FakeShell(),
      fs: new FakeFs(),
    });

    await (
      api as unknown as {
        d1MigrationsApply: (
          db: string,
          cfg: string,
          root?: string,
          dir?: string,
        ) => Promise<void>;
      }
    ).d1MigrationsApply("mydb", "dist/wrangler.jsonc", ".", "dist/migrations");

    return commands;
  };

  it("never invokes `d1 migrations apply`", async ({ expect }) => {
    const commands = await capture(["0001_init.sql", "0002_rebuild.sql"]);
    expect(commands.some((c) => c.includes("d1 migrations apply"))).toBe(false);
  });

  it("applies each pending migration with `execute --file`", async ({
    expect,
  }) => {
    const commands = await capture(["0001_init.sql", "0002_rebuild.sql"]);

    const applied = commands.filter((c) => c.includes("--file="));
    expect(applied).toHaveLength(2);
    expect(applied[0]).toContain("dist/migrations/0001_init.sql");
    expect(applied[1]).toContain("dist/migrations/0002_rebuild.sql");
    // Order matters: a rebuild that runs before its table exists fails.
    expect(applied[0].indexOf("0001")).toBeGreaterThan(-1);
  });

  it("records each applied migration in wrangler's own table", async ({
    expect,
  }) => {
    const commands = await capture(["0001_init.sql"]);

    expect(
      commands.some((c) =>
        c.includes("CREATE TABLE IF NOT EXISTS d1_migrations"),
      ),
    ).toBe(true);
    expect(
      commands.some(
        (c) =>
          c.includes("INSERT INTO d1_migrations") &&
          c.includes("0001_init.sql"),
      ),
    ).toBe(true);
  });

  it("ignores non-SQL files and applies in sorted order", async ({
    expect,
  }) => {
    const commands = await capture([
      "0002_second.sql",
      "README.md",
      "0001_first.sql",
    ]);

    const applied = commands
      .filter((c) => c.includes("--file="))
      .map((c) => c.split("--file=")[1]);
    expect(applied).toHaveLength(2);
    expect(applied[0]).toContain("0001_first.sql");
    expect(applied[1]).toContain("0002_second.sql");
  });
});
