import { Alepha } from "alepha";
import {
  CliProvider,
  CommandError,
  ConsoleOutputProvider,
  MemoryOutputProvider,
} from "alepha/command";
import { FileSystemProvider, MemoryFileSystemProvider } from "alepha/system";
import { describe, expect, it } from "vitest";

import { CheckCommand } from "../commands/check.ts";

describe("alepha check", () => {
  const create = async (files: Record<string, string>) => {
    const alepha = Alepha.create({ env: { LOG_LEVEL: "silent" } })
      .with({ provide: FileSystemProvider, use: MemoryFileSystemProvider })
      .with({ provide: ConsoleOutputProvider, use: MemoryOutputProvider });
    const fs = alepha.inject(MemoryFileSystemProvider);
    for (const [path, content] of Object.entries(files)) {
      const absolute = `/app/${path}`;
      await fs.mkdir(absolute.slice(0, absolute.lastIndexOf("/")), {
        recursive: true,
      });
      await fs.writeFile(absolute, content);
    }
    return {
      cli: alepha.inject(CliProvider),
      cmd: alepha.inject(CheckCommand),
      output: alepha.inject(MemoryOutputProvider),
    };
  };

  it("prints file:line, the rule id and the fix, then fails", async () => {
    const { cli, cmd, output } = await create({
      "src/api/OrderService.ts":
        "export class OrderService {\n  at = Date.now();\n}\n",
    });

    await expect(cli.run(cmd.check, { root: "/app" })).rejects.toThrow(
      CommandError,
    );

    expect(output.text).toContain("src/api/OrderService.ts:2  no-date-now");
    expect(output.text).toContain(
      "  Date.now() cannot be travelled in a test. Inject DateTimeProvider",
    );
    expect(output.text).toContain("1 finding in 1 file (1 file checked).");
  });

  it("succeeds and says so on a clean tree, which it never boots", async () => {
    // An entry that would end the process if it were imported: `check` reads source.
    const { cli, cmd, output } = await create({
      "src/main.server.ts": "process.exit(42);\n",
    });

    await cli.run(cmd.check, { root: "/app" });
    expect(output.text).toBe("No convention finding in 1 file.");
  });

  it("prints one JSON array with --json, and still fails", async () => {
    const { cli, cmd, output } = await create({
      "src/a.ts": "Date.now();\n",
    });

    await expect(
      cli.run(cmd.check, { root: "/app", argv: "--json" }),
    ).rejects.toThrow(CommandError);

    expect(JSON.parse(output.text)).toEqual([
      {
        file: "src/a.ts",
        line: 1,
        column: 1,
        rule: "no-date-now",
        message: "Date.now() cannot be travelled in a test.",
        fix: expect.any(String),
      },
    ]);
  });

  it("prints an empty array with --json on a clean tree", async () => {
    const { cli, cmd, output } = await create({ "src/a.ts": "export {};\n" });

    await cli.run(cmd.check, { root: "/app", argv: "--json" });
    expect(JSON.parse(output.text)).toEqual([]);
  });

  it("narrows to a positional path", async () => {
    const { cli, cmd, output } = await create({
      "src/a/x.ts": "Date.now();\n",
      "src/b/y.ts": "export {};\n",
    });

    await cli.run(cmd.check, { root: "/app", argv: "src/b" });
    expect(output.text).toBe("No convention finding in 1 file.");
  });

  it("refuses an unknown --rule, naming the valid ids", async () => {
    const { cli, cmd } = await create({ "src/a.ts": "" });

    await expect(
      cli.run(cmd.check, { root: "/app", argv: "--rule no-such" }),
    ).rejects.toThrow("Valid ids: no-date-now");
  });
});
