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
  ConsoleOutputProvider,
  cliOptions,
  MemoryOutputProvider,
} from "../index.ts";

class DeployCommands {
  vercel = $command({
    name: "vercel",
    description: "Deploy to Vercel",
    flags: z.object({
      token: z.text({ description: "The Vercel token" }).optional(),
    }),
    handler: async () => {},
  });

  deploy = $command({
    name: "deploy",
    description: "Deploy the application",
    children: [this.vercel],
    handler: async ({ help }) => help(),
  });

  build = $command({
    name: "build",
    description: "Build the application",
    flags: z.object({
      watch: z.boolean().describe("Rebuild on change").optional(),
    }),
    handler: async () => {},
  });
}

/**
 * Start a CLI container on an argv, and hand back what it printed and the
 * exit code it left.
 */
const run = async (
  argv: string[],
  commands: new () => object = DeployCommands,
) => {
  const alepha = Alepha.create({ env: { NO_COLOR: "true" } })
    .with({ provide: LogDestinationProvider, use: MemoryDestinationProvider })
    .with({ provide: ConsoleOutputProvider, use: MemoryOutputProvider })
    .with(commands);
  alepha.store.mut(cliOptions, (old) => ({ ...old, name: "cli", argv }));
  await alepha.start();

  const exitCode = process.exitCode;
  process.exitCode = 0;
  return { stdout: alepha.inject(MemoryOutputProvider).text, exitCode };
};

describe("help as a word", () => {
  it("prints exactly what --help prints, for a command", async ({ expect }) => {
    const word = await run(["help", "build"]);
    const flag = await run(["build", "--help"]);

    expect(word.stdout).toContain("Usage: cli build");
    expect(word.stdout).toBe(flag.stdout);
    expect(word.exitCode).not.toBe(1);
  });

  it("prints exactly what --help prints, for a nested command", async ({
    expect,
  }) => {
    const word = await run(["help", "deploy", "vercel"]);
    const flag = await run(["deploy", "vercel", "-h"]);

    expect(word.stdout).toContain("Usage: cli deploy vercel");
    expect(word.stdout).toBe(flag.stdout);
  });

  it("prints the root help on its own, and exits 0 rather than 'Unknown command'", async ({
    expect,
  }) => {
    const word = await run(["help"]);
    const flag = await run(["--help"]);

    expect(word.stdout).toContain("Commands:");
    expect(word.stdout).toBe(flag.stdout);
    expect(word.exitCode).not.toBe(1);
  });

  it("names itself beside the other argv conventions", async ({ expect }) => {
    const { stdout } = await run(["--help"]);

    expect(stdout).toContain("help <command> prints a command's help");
  });

  it("leaves a CLI's own command named help alone", async ({ expect }) => {
    const ran: string[] = [];

    class OwnHelpCommands {
      help = $command({
        name: "help",
        args: z.text({ title: "topic" }).optional(),
        handler: async ({ args }) => {
          ran.push(args ?? "");
        },
      });

      build = $command({ name: "build", handler: async () => {} });
    }

    const { stdout } = await run(["help", "build"], OwnHelpCommands);

    expect(ran).toEqual(["build"]);
    expect(stdout).not.toContain("Usage:");
  });
});
