import { cp, glob, rm } from "node:fs/promises";
import { $inject, Alepha } from "alepha";
import { $logger } from "alepha/logger";
import { ShellProvider } from "alepha/system";
import { CommandError } from "../errors/CommandError.ts";
import { PrettyPrint } from "./PrettyPrint.ts";

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
}

export class Runner {
  protected readonly log = $logger();
  protected readonly timers: Timer[] = [];
  protected readonly startTime: number = Date.now();
  protected readonly prettyPrint = $inject(PrettyPrint);
  protected readonly alepha = $inject(Alepha);
  protected readonly shell = $inject(ShellProvider);
  public readonly run: RunnerMethod;
  protected cliName = "";
  protected commandName = "";
  protected firstTaskStarted = false;

  constructor() {
    this.run = this.createRunMethod();
  }

  protected get useDynamicLogger() {
    if (this.alepha.isCI()) {
      return false;
    }

    return this.alepha.env.LOG_FORMAT === "raw";
  }

  /**
   * Start a new command session with header (for pretty print mode)
   */
  public startCommand(cliName: string, commandName: string): void {
    this.cliName = cliName;
    this.commandName = commandName;
  }

  protected createRunMethod() {
    const runFn: RunnerMethod = async (
      cmd: string | Task | Array<string | Task>,
      options?: RunOptions | (() => any),
    ) => {
      if (this.useDynamicLogger && !this.firstTaskStarted) {
        this.prettyPrint.startCommand(this.cliName, this.commandName);
      }

      this.firstTaskStarted = true;

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

    return runFn;
  }

  protected async exec(
    cmd: string,
    opts: { root?: string } = {},
  ): Promise<string> {
    return this.shell.run(cmd, { root: opts.root, capture: true });
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
    if (this.useDynamicLogger && this.firstTaskStarted) {
      this.prettyPrint.endCommand();
      return;
    }

    // Non-dynamic mode: use logging
    if (this.timers.length === 0) return;

    this.log.info("");
    const totalTime = ((Date.now() - this.startTime) / 1000).toFixed(1);
    this.log.info(`Total time: ${totalTime}s`);
    this.log.info(``);
  }

  protected async executeTask(task: Task): Promise<string> {
    const now = Date.now();
    const taskId = task.name; // Use task name as unique ID

    // Setup dynamic logger
    if (this.useDynamicLogger) {
      this.prettyPrint.startSpinner(taskId, task.name);
    } else {
      this.log.info(`Starting '${task.name}' ...`);
    }

    let stdout = "";

    try {
      stdout = String((await task.handler()) ?? "");
    } catch (error) {
      // Clear spinner and show error
      if (this.useDynamicLogger) {
        this.prettyPrint.error(taskId, task.name);
      }
      if (error instanceof Error && "stdout" in error) {
        this.log.info(`\n\n${error.stdout}`);
      }
      throw new CommandError(`Task '${task.name}' failed`, { cause: error });
    }

    if (stdout) this.log.trace(stdout);

    const duration = ((Date.now() - now) / 1000).toFixed(1);

    // Clear spinner and show completion
    if (this.useDynamicLogger) {
      this.prettyPrint.success(taskId, task.name, `${duration}s`);
    } else {
      this.log.info(`Finished '${task.name}' after ${duration}s`);
    }

    this.timers.push({
      name: task.name,
      duration: `${duration}s`,
    });

    return stdout;
  }

  protected renderTable(data: string[][]): void {
    if (data.length === 0) return;

    const col1Width = Math.max(...data.map(([col1]) => col1.length), 7);
    const col2Width = Math.max(...data.map(([, col2]) => col2.length), 8);

    const divider = `+${"-".repeat(col1Width + 2)}+${"-".repeat(
      col2Width + 2,
    )}+`;
    this.log.info(divider);
    this.log.info(
      `| ${"Command".padEnd(col1Width)} | ${"Duration".padEnd(col2Width)} |`,
    );
    this.log.info(divider);
    for (const [col1, col2] of data) {
      this.log.info(
        `| ${col1.padEnd(col1Width)} | ${col2.padEnd(col2Width)} |`,
      );
    }
    this.log.info(divider);
  }
}
