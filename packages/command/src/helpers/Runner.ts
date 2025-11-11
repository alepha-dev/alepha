import { exec } from "node:child_process";
import { cp, glob, rm } from "node:fs/promises";
import { $logger } from "@alepha/logger";
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
  public readonly run: RunnerMethod;

  constructor() {
    this.run = this.createRunMethod();
  }

  protected createRunMethod() {
    const runFn: RunnerMethod = async (
      cmd: string | Task | Array<string | Task>,
      options?: RunOptions | (() => any),
    ) => {
      if (Array.isArray(cmd)) {
        return await this.execute(
          cmd.map((it) =>
            typeof it === "string"
              ? { name: it, handler: () => this.exec(it) }
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
            ? () => this.exec(cmd)
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
              console.log(file);
              this.log.trace(`Removing ${file}`);
              await rm(file, { recursive: true, force: true });
            }
          },
        });
      }
      this.log.trace(`Removing ${files}`);
      return runFn({
        name: `rm -rf ${files}`,
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

  protected async exec(cmd: string): Promise<string> {
    return await new Promise<string>((resolve, reject) => {
      exec(cmd, (err, stdout) => {
        if (err) {
          err.stdout = stdout;
          reject(err);
        } else {
          resolve(stdout);
        }
      });
    });
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
  public summary(): void {
    if (this.timers.length === 0) return;
    this.log.info("");
    this.renderTable(this.timers.map((t) => [t.name, t.duration]));
    const totalTime = ((Date.now() - this.startTime) / 1000).toFixed(2);
    this.log.info(`Total time: ${totalTime} s`);
    this.log.info(``);
  }

  protected async executeTask(task: Task): Promise<string> {
    this.log.info(`Starting '${task.name}' ...`);
    const now = Date.now();

    let stdout = "";

    try {
      stdout = String((await task.handler()) ?? "");
    } catch (error) {
      if (error instanceof Error && "stdout" in error) {
        this.log.info(`\n\n${error.stdout}`);
      }
      throw new CommandError(`Task '${task.name}' failed`, { cause: error });
    }

    this.log.trace(stdout);

    const duration = ((Date.now() - now) / 1000).toFixed(2);
    this.log.info(`Finished '${task.name}' after ${duration}s`);

    this.timers.push({
      name: task.name,
      duration: `${duration} s`,
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
