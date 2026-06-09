import { cp, glob, rm } from "node:fs/promises";
import { $inject, Alepha } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $logger } from "alepha/logger";
import { ShellProvider } from "alepha/system";
import { CommandError } from "../errors/CommandError.ts";

export type Task = {
  name: string;
  handler: () => any;
};

interface Timer {
  name: string;
  duration: string;
}

export interface RunOptions {
  /**
   * Rename the command for logging purposes.
   */
  alias?: string;

  /**
   * Root directory to execute the command in.
   */
  root?: string;
}

export interface RunnerMethod {
  (
    cmd: string | Task | Array<string | Task>,
    options?: RunOptions | (() => any),
  ): Promise<string>;
  rm: (glob: string | string[], options?: RunOptions) => Promise<string>;
  cp: (source: string, dest: string, options?: RunOptions) => Promise<string>;

  /**
   * Ends the runner and prints a summary of executed tasks.
   *
   * > This is automatically called at the end of command execution.
   * > But can be called manually if needed to print more stuff before the command ends.
   */
  end: () => void;
}

/**
 * Runs CLI tasks (shell commands or functions) and logs their lifecycle.
 *
 * Output is intentionally plain and verbose: every task logs a
 * `Starting …` / `Finished … after Ns` line through the standard logger,
 * and shelled commands **stream** their stdout/stderr straight to the
 * terminal (`capture: false`) so tool output — `vite build` warnings,
 * Biome diagnostics, nested `alepha` subcommands — is visible live.
 */
export class Runner {
  protected readonly log = $logger();
  protected readonly dateTime = $inject(DateTimeProvider);
  protected timers: Timer[] = [];
  protected readonly startTime: number = this.dateTime.nowMillis();
  protected readonly alepha = $inject(Alepha);
  protected readonly shell = $inject(ShellProvider);
  public readonly run: RunnerMethod;

  constructor() {
    this.run = this.createRunMethod();
  }

  /**
   * Start a new command session.
   *
   * Retained for API compatibility (the CLI calls it before each command);
   * task lifecycle is now logged statelessly, so there is nothing to reset.
   */
  public startCommand(_cliName: string, _commandName: string): void {}

  protected createRunMethod() {
    const runFn: RunnerMethod = async (
      cmd: string | Task | Array<string | Task>,
      options?: RunOptions | (() => any),
    ) => {
      const root =
        typeof options === "object" && options.root ? options.root : undefined;

      if (Array.isArray(cmd)) {
        return await this.execute(
          cmd.map((it) =>
            typeof it === "string"
              ? { name: it, handler: () => this.exec(it, { root }) }
              : it,
          ),
        );
      }

      const alias = typeof options === "object" ? options.alias : undefined;
      const name = alias ?? (typeof cmd === "string" ? cmd : cmd.name);
      const handler =
        typeof options === "function"
          ? options
          : typeof cmd === "string"
            ? () => this.exec(cmd, { root })
            : cmd.handler;

      return await this.execute({
        name,
        handler,
      });
    };

    runFn.rm = async (
      files: string | string[],
      options: RunOptions = {},
    ): Promise<string> => {
      if (Array.isArray(files) || files.includes("*")) {
        return runFn({
          name:
            options.alias ??
            `rm -rf ${Array.isArray(files) ? files.join(" ") : files}`,
          handler: async () => {
            for await (const file of glob(files)) {
              this.log.trace(`Removing ${file}`);
              await rm(file, { recursive: true, force: true });
            }
          },
        });
      }
      this.log.trace(`Removing ${files}`);
      return runFn({
        name: options.alias ?? `rm -rf ${files}`,
        handler: () => rm(files, { recursive: true, force: true }),
      });
    };

    runFn.cp = async (
      source: string,
      dist: string,
      options: RunOptions = {},
    ): Promise<string> => {
      this.log.trace(`Copying ${source} to ${dist}`);
      return runFn(
        {
          name: options.alias ?? `cp -r ${source} ${dist}`,
          handler: () => cp(source, dist, { recursive: true }),
        },
        options,
      );
    };

    runFn.end = () => this.end();

    return runFn;
  }

  protected async exec(
    cmd: string,
    opts: { root?: string } = {},
  ): Promise<string> {
    // Stream output straight to the terminal (capture: false) so the user
    // sees tool output live. The returned string is therefore empty.
    return this.shell.run(cmd, { root: opts.root, capture: false });
  }

  /**
   * Executes one or more tasks.
   *
   * @param task - A single task or an array of tasks to run in parallel.
   */
  protected async execute(task: Task | Task[]): Promise<string> {
    if (Array.isArray(task)) {
      await Promise.all(task.map((t) => this.executeTask(t)));
      return ""; // not supported for now
    } else {
      return await this.executeTask(task);
    }
  }

  /**
   * Prints a summary of all executed tasks and their durations.
   */
  public end(): void {
    if (this.timers.length === 0) return;

    const totalTime = (
      (this.dateTime.nowMillis() - this.startTime) /
      1000
    ).toFixed(1);
    this.log.info(`Total time: ${totalTime}s`);

    // clear timers after rendering
    this.timers = [];
  }

  protected async executeTask(task: Task): Promise<string> {
    const now = this.dateTime.nowMillis();

    this.log.info(`Starting '${task.name}' ...`);

    let stdout = "";

    try {
      stdout = String((await task.handler()) ?? "");
    } catch (error) {
      // Streamed tasks have already printed their output live; this only
      // surfaces output from handlers that captured it internally (capture:
      // true) before throwing.
      if (error instanceof Error && "stdout" in error && error.stdout) {
        this.log.info(`\n\n${error.stdout}`);
      }
      throw new CommandError(`Task '${task.name}' failed`, { cause: error });
    }

    if (stdout) this.log.trace(stdout);

    const duration = ((this.dateTime.nowMillis() - now) / 1000).toFixed(1);

    const message =
      stdout && !stdout.includes("\n") ? stdout.trim() : undefined;
    const suffix = message ? ` - ${message}` : "";
    this.log.info(`Finished '${task.name}' after ${duration}s${suffix}`);

    this.timers.push({
      name: task.name,
      duration: `${duration}s`,
    });

    return stdout;
  }
}
