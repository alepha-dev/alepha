import { Alepha } from "alepha";
import {
  $logger,
  ConsoleDestinationProvider,
  LogDestinationProvider,
} from "alepha/logger";
import { describe, it } from "vitest";

// Through the module's index, not the files: importing it is what ties
// `$command` to `AlephaCommand`, so the CLI provider is registered at all.
import {
  $command,
  ConsoleOutputProvider,
  cliOptions,
  MemoryOutputProvider,
} from "../index.ts";

/**
 * The console destination, with its two streams recorded instead of written.
 */
class RecordingConsoleDestination extends ConsoleDestinationProvider {
  public readonly stdout: string[] = [];
  public readonly stderr: string[] = [];

  protected override writeStdout(message: string): void {
    this.stdout.push(message);
  }

  protected override writeStderr(message: string): void {
    this.stderr.push(message);
  }
}

/**
 * A container as a CLI binary builds one: the real console destination
 * (recorded), `print` captured, the argv it was started with, and the level
 * both bins set, which keeps the core's own start-up lines quiet (they are
 * written before the CLI knows it is one).
 */
const boot = async (argv: string[], commands: new () => object) => {
  const alepha = Alepha.create({
    env: {
      LOG_LEVEL: "alepha.core:warn,info",
      LOG_FORMAT: "raw",
      NO_COLOR: "true",
    },
  })
    .with({ provide: LogDestinationProvider, use: RecordingConsoleDestination })
    .with({ provide: ConsoleOutputProvider, use: MemoryOutputProvider })
    .with(commands);
  alepha.store.mut(cliOptions, (old) => ({ ...old, argv }));

  await alepha.start();

  return {
    alepha,
    logs: alepha.inject(RecordingConsoleDestination),
    stdout: alepha.inject(MemoryOutputProvider),
  };
};

describe("CliProvider log stream", () => {
  it("leaves exactly what a command prints on stdout, and its logs on stderr", async ({
    expect,
  }) => {
    class ReportCommands {
      log = $logger();

      report = $command({
        name: "report",
        handler: async ({ print }) => {
          this.log.info("Reading the report");
          print('{"total":3}');
          this.log.warn("One row was skipped");
        },
      });
    }

    const { logs, stdout } = await boot(["report"], ReportCommands);

    expect(stdout.lines).toEqual(['{"total":3}']);
    expect(logs.stdout).toEqual([]);
    expect(logs.stderr.join("\n")).toContain("Reading the report");
    expect(logs.stderr.join("\n")).toContain("One row was skipped");
  });

  it("puts a usage error's reason on stderr and the help it prints on stdout", async ({
    expect,
  }) => {
    class ToolCommands {
      build = $command({ name: "build", handler: async () => {} });
    }

    const { logs, stdout } = await boot(["biuld"], ToolCommands);

    expect(logs.stdout).toEqual([]);
    expect(logs.stderr.join("\n")).toContain("Unknown command: 'biuld'");
    expect(stdout.text).toContain("Commands:");

    process.exitCode = 0;
  });

  /**
   * `alepha dev` boots the application's own container inside the CLI's
   * process. That container's logs are the application's output wherever it
   * runs, so the CLI's choice must not reach it: it is written to the CLI
   * container's store, and a store belongs to one container.
   */
  it("leaves an application container booted by a command on stdout", async ({
    expect,
  }) => {
    class Application {
      log = $logger();
    }

    const app = Alepha.create({
      env: { LOG_LEVEL: "info", LOG_FORMAT: "raw", NO_COLOR: "true" },
    })
      .with({
        provide: LogDestinationProvider,
        use: RecordingConsoleDestination,
      })
      .with(Application);

    class DevCommands {
      log = $logger();

      dev = $command({
        name: "dev",
        handler: async () => {
          this.log.info("Starting the application");
          await app.start();
          app.inject(Application).log.info("Listening on 3000");
        },
      });
    }

    const { logs } = await boot(["dev"], DevCommands);
    const appLogs = app.inject(RecordingConsoleDestination);

    expect(logs.stderr.join("\n")).toContain("Starting the application");
    expect(appLogs.stdout.join("\n")).toContain("Listening on 3000");
    expect(appLogs.stderr.join("\n")).not.toContain("Listening on 3000");

    await app.stop();
  });

  /**
   * A server that registers a command for maintenance is not a CLI when it is
   * started with nothing to run.
   */
  it("leaves the logs of a container that runs no command on stdout", async ({
    expect,
  }) => {
    class ServerWithCommands {
      log = $logger();

      migrate = $command({ name: "migrate", handler: async () => {} });
    }

    const { alepha, logs } = await boot([], ServerWithCommands);
    alepha.inject(ServerWithCommands).log.info("Serving");

    expect(logs.stdout.join("\n")).toContain("Serving");
    expect(logs.stderr).toEqual([]);
  });
});
