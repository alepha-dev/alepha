import { Alepha, z } from "alepha";
import {
  LogDestinationProvider,
  MemoryDestinationProvider,
} from "alepha/logger";
import { describe, it } from "vitest";

// Through the module's index: importing it is what ties `$command` to
// `AlephaCommand`, so the CLI provider is registered at all.
import {
  $command,
  CliProvider,
  ConsoleOutputProvider,
  cliOptions,
  MemoryOutputProvider,
} from "../index.ts";

/**
 * What ran, in order.
 */
const ran: string[] = [];

/**
 * Two commands declare `--watch` and `--fix` as booleans, and `tail`,
 * registered before them, declares both as flags taking a value.
 */
class Commands {
  tail = $command({
    name: "tail",
    flags: z.object({
      watch: z.text().optional(),
      fix: z.text().optional(),
    }),
    handler: () => void ran.push("tail"),
  });

  migrate = $command({
    name: "migrate",
    flags: z.object({ name: z.text().optional() }),
    handler: ({ flags }) => void ran.push(`migrate ${flags.name ?? ""}`.trim()),
  });

  db = $command({
    name: "db",
    flags: z.object({ watch: z.boolean().optional() }),
    children: [this.migrate],
    handler: ({ help }) => {
      ran.push("db");
      help();
    },
  });

  lint = $command({
    name: "lint",
    flags: z.object({ fix: z.boolean().optional() }),
    handler: ({ flags }) => void ran.push(`lint fix=${flags.fix}`),
  });
}

/**
 * Start a CLI container on an argv, and hand back what ran, the errors it
 * logged and the exit code it left.
 */
const run = async (argv: string[]) => {
  ran.length = 0;
  const alepha = Alepha.create({ env: { NO_COLOR: "true" } })
    .with({ provide: LogDestinationProvider, use: MemoryDestinationProvider })
    .with({ provide: ConsoleOutputProvider, use: MemoryOutputProvider })
    .with(Commands);
  alepha.store.mut(cliOptions, (old) => ({ ...old, name: "cli", argv }));
  await alepha.start();

  const exitCode = process.exitCode;
  process.exitCode = 0;
  return {
    ran: [...ran],
    exitCode,
    errors: alepha
      .inject(MemoryDestinationProvider)
      .logs.filter((entry) => entry.level === "ERROR")
      .map((entry) => entry.message),
  };
};

describe("a flag declared differently by two commands", () => {
  it("is read as the invoked command declares it, so a stray word after a boolean is refused", async ({
    expect,
  }) => {
    // Read as `tail` declares `--fix`, `srcc` was its value: `lint` ran and
    // exited 0 with the word dropped.
    const typo = await run(["lint", "--fix", "srcc"]);

    expect(typo.ran).toEqual([]);
    expect(typo.exitCode).toBe(1);
    expect(typo.errors).toEqual([
      "Unexpected argument 'srcc': 'lint' takes no positional arguments.",
    ]);

    expect((await run(["lint", "--fix"])).ran).toEqual(["lint fix=true"]);
  });

  it("is read as the group declares it, so the word after it is still the subcommand", async ({
    expect,
  }) => {
    // Read as `tail` declares `--watch`, `migrate` was its value: the `db`
    // group printed its help and exited 0. `migrate` does not take
    // `--watch`, and says so.
    for (const argv of [
      ["db", "--watch", "migrate"],
      ["db", "--watch", "migrate", "--name", "init"],
    ]) {
      const result = await run(argv);

      expect(result.ran).toEqual([]);
      expect(result.exitCode).toBe(1);
      expect(result.errors).toEqual(["Unknown flag: --watch"]);
    }
  });

  it("still reads the flag as its own command declares it", async ({
    expect,
  }) => {
    expect((await run(["tail", "--watch", "migrate"])).ran).toEqual(["tail"]);
    expect((await run(["tail", "--fix", "srcc"])).ran).toEqual(["tail"]);
    expect((await run(["db", "migrate", "--name", "init"])).ran).toEqual([
      "migrate init",
    ]);
    expect((await run(["db", "--name", "init", "migrate"])).ran).toEqual([
      "migrate init",
    ]);
  });
});

/**
 * A child that redeclares its parent's flag with another arity. `leaf` is
 * registered first, so the superset reads `--f` as taking a value.
 */
class Redeclared {
  leaf = $command({
    name: "leaf",
    flags: z.object({ f: z.text().optional() }),
    handler: () => void ran.push("group leaf"),
  });

  group = $command({
    name: "group",
    flags: z.object({ f: z.boolean().optional() }),
    args: z.text().optional(),
    children: [this.leaf],
    handler: () => void ran.push("group"),
  });
}

class TestCliProvider extends CliProvider {
  public testResolve(argv: string[]) {
    const { command, consumedArgs, positionalArgs } =
      this.resolveCommandFromArgv(argv);
    return { name: command?.name, consumedArgs, positionalArgs };
  }
}

describe("a child redeclaring its parent's flag with another arity", () => {
  it("resolves to the superset's answer, whatever the number of tokens", ({
    expect,
  }) => {
    // The group reads `--f` as a boolean and finds `leaf`; `leaf` reads it
    // as taking `leaf` for its value and finds the group again. Stopping
    // after a number of passes made the answer depend on the argv's length.
    const cli = Alepha.create().with(Redeclared).inject(TestCliProvider);

    for (const argv of [
      ["group", "--f", "leaf"],
      ["group", "--f", "leaf", "--verbose"],
      ["group", "--f", "leaf", "a"],
      ["group", "--f", "leaf", "a", "b"],
    ]) {
      const resolved = cli.testResolve(argv);

      expect(resolved.name).toBe("group");
      expect(resolved.consumedArgs).toEqual(["group"]);
      expect(resolved.positionalArgs).toEqual(
        argv.filter((word) => !["--f", "leaf", "--verbose"].includes(word)),
      );
    }

    expect(cli.testResolve(["group", "leaf", "--f", "v"]).name).toBe("leaf");
  });
});
