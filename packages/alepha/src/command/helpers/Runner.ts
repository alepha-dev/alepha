import { cp, glob, rm } from "node:fs/promises";
import { resolve } from "node:path";
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
 * Output is intentionally plain: every task logs a
 * `Starting …` / `Finished … after Ns` line through the standard logger.
 * Shelled commands stream their stdout/stderr live only when DEBUG-level
 * logging is enabled (e.g. `LOG_LEVEL=debug`); at the default level their
 * output is captured and surfaced on failure.
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
      const root = options.root;

      if (Array.isArray(files) || files.includes("*")) {
        return runFn({
          name:
            options.alias ??
            `rm -rf ${Array.isArray(files) ? files.join(" ") : files}`,
          handler: async () => {
            // `glob` yields paths relative to its cwd, so re-anchor each match
            // before deleting — otherwise a matched entry would be resolved
            // against process.cwd() and silently miss (or hit the wrong tree).
            for await (const file of glob(files, root ? { cwd: root } : {})) {
              const target = this.resolveIn(root, file);
              this.log.trace(`Removing ${target}`);
              await rm(target, { recursive: true, force: true });
            }
          },
        });
      }

      const target = this.resolveIn(root, files);
      this.log.trace(`Removing ${target}`);
      return runFn({
        name: options.alias ?? `rm -rf ${files}`,
        handler: () => rm(target, { recursive: true, force: true }),
      });
    };

    runFn.cp = async (
      source: string,
      dist: string,
      options: RunOptions = {},
    ): Promise<string> => {
      const from = this.resolveIn(options.root, source);
      const to = this.resolveIn(options.root, dist);
      this.log.trace(`Copying ${from} to ${to}`);
      return runFn(
        {
          name: options.alias ?? `cp -r ${source} ${dist}`,
          handler: () => cp(from, to, { recursive: true }),
        },
        options,
      );
    };

    runFn.end = () => this.end();

    return runFn;
  }

  /**
   * Anchor a caller-supplied path inside `root`.
   *
   * Absolute paths are returned untouched — `root` scopes relative work, it
   * does not confine it — and with no `root` the path keeps resolving against
   * `process.cwd()`, which is the pre-existing behaviour.
   */
  protected resolveIn(root: string | undefined, path: string): string {
    return root ? resolve(root, path) : path;
  }

  protected async exec(
    cmd: string,
    opts: { root?: string } = {},
  ): Promise<string> {
    // Stream child output straight to the terminal only when DEBUG (or more
    // verbose) is enabled — i.e. under `--verbose`, an agent session
    // (CLAUDECODE), or `LOG_LEVEL=debug`. Otherwise capture it so a quiet run
    // (e.g. `alepha verify`) is not buried under sub-process output; captured
    // output is surfaced on failure by {@link executeTask}.
    const stream = this.log.isLevelEnabled("DEBUG");
    return this.shell.run(cmd, { root: opts.root, capture: !stream });
  }

  /**
   * Executes one or more tasks.
   *
   * @param task - A single task or an array of tasks to run in parallel.
   */
  protected async execute(task: Task | Task[]): Promise<string> {
    if (Array.isArray(task)) {
      const outputs = await Promise.all(task.map((t) => this.executeTask(t)));
      // Order follows the input array, not completion order, so the result is
      // deterministic regardless of how the parallel tasks interleave.
      return outputs.filter(Boolean).join("\n");
    }
    return await this.executeTask(task);
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
      // Streamed tasks have already printed their output live and reject
      // without stdout/stderr attached; this surfaces output from captured
      // tasks (capture: true — the default below DEBUG) before throwing.
      const err = error as { stdout?: string; stderr?: string };
      const captured = [err?.stdout, err?.stderr]
        .filter(Boolean)
        .join("\n")
        .trim();
      if (captured) {
        this.log.info(`\n\n${captured}`);
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
