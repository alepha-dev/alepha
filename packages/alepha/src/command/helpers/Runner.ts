import { cp, glob, rm } from "node:fs/promises";
import { resolve } from "node:path";

import { $inject, Alepha } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $logger } from "alepha/logger";
import { ShellProvider } from "alepha/system";

import { CommandError } from "../errors/CommandError.ts";
import { ExclusiveProvider } from "../providers/ExclusiveProvider.ts";
import { TaskCacheProvider } from "../providers/TaskCacheProvider.ts";

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

  /**
   * Hold a machine-wide slot, named by this key, for the duration of the task.
   *
   * The same queue `$command`'s `exclusive` option uses, one level down: a
   * pipeline that contends for something in two of its twelve steps queues for
   * those two rather than for all twelve. A second process running a task
   * under the same key waits its turn instead of failing.
   *
   * A string only, and never derived: at this level there is no command name
   * to build a key from, and a key that differed per call site would queue
   * every caller behind itself and protect nothing. Name the resource, and
   * namespace it (`myapp:postgres`), because the queue is machine-wide and
   * shared with every other project on the machine.
   *
   * An array of tasks takes ONE slot for the whole group, so tasks meant to
   * run together still do.
   */
  exclusive?: string;

  /**
   * Skip this task when a task with the same key has already passed.
   *
   * The key is the caller's to compute and must cover everything the task
   * reads: see {@link TaskCacheProvider}. A task that throws is never recorded, so
   * a red step cannot cache itself green, and an array of tasks is one unit
   * under one key exactly as `exclusive` is one slot for a group.
   *
   * ⚠️ Nothing is restored. This records that a task passed, not what it
   * produced, so it suits checks and suites rather than anything whose point
   * is a file on disk. For those, `alepha build --if-stale` compares the
   * artifact against its sources instead of trusting a record.
   */
  cache?: string;
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
  protected readonly exclusive = $inject(ExclusiveProvider);
  protected readonly cache = $inject(TaskCacheProvider);
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

      let tasks: Task | Task[];

      if (Array.isArray(cmd)) {
        tasks = cmd.map((it) =>
          typeof it === "string"
            ? { name: it, handler: () => this.exec(it, { root }) }
            : it,
        );
      } else {
        const alias = typeof options === "object" ? options.alias : undefined;
        const name = alias ?? (typeof cmd === "string" ? cmd : cmd.name);
        const handler =
          typeof options === "function"
            ? options
            : typeof cmd === "string"
              ? () => this.exec(cmd, { root })
              : cmd.handler;

        tasks = { name, handler };
      }

      const cacheKey = typeof options === "object" ? options.cache : undefined;

      if (cacheKey && (await this.cache.isFresh(cacheKey))) {
        const name = Array.isArray(tasks)
          ? tasks.map((it) => it.name).join(" + ")
          : tasks.name;
        // Announced, never silent. A skipped step that prints nothing looks
        // exactly like a step that ran and found nothing to do, and the whole
        // risk of a cache is that it says a task passed against code it has
        // never seen.
        this.log.info(`Skipping '${name}': cached (${cacheKey.slice(0, 12)})`);
        return "";
      }

      // Recorded only after the task resolves. Recording up front, or in a
      // `finally`, turns one red run into a permanently green one.
      const remember = async <T>(result: Promise<T>): Promise<T> => {
        const value = await result;
        if (cacheKey) {
          await this.cache.record(cacheKey);
        }
        return value;
      };

      const key = typeof options === "object" ? options.exclusive : undefined;

      if (!key) {
        return await remember(this.execute(tasks));
      }

      // One slot around the whole group, not one per task: an array is tasks
      // that were asked to run together, and a ticket each would make the
      // group wait for itself.
      const slot = await this.exclusive.acquire(key, {
        command: Array.isArray(tasks)
          ? tasks.map((it) => it.name).join(" + ")
          : tasks.name,
        cwd: root ?? process.cwd(),
      });

      try {
        return await remember(this.execute(tasks));
      } finally {
        await slot.release();
      }
    };

    runFn.rm = async (
      files: string | string[],
      options: RunOptions = {},
    ): Promise<string> => {
      const root = options.root;

      // `options` is forwarded so `exclusive` is honoured here too. `rm` and
      // `cp` build their own Task, and `rm` used to drop the caller's options
      // on the floor: the same class of silent no-op that `root` was fixed for.
      if (Array.isArray(files) || files.includes("*")) {
        return runFn(
          {
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
          },
          options,
        );
      }

      const target = this.resolveIn(root, files);
      this.log.trace(`Removing ${target}`);
      return runFn(
        {
          name: options.alias ?? `rm -rf ${files}`,
          handler: () => rm(target, { recursive: true, force: true }),
        },
        options,
      );
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
   * Prints the total time once at least one task ran, then forgets them.
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

    // Shell output ends with a newline, so test for a single line AFTER
    // trimming or the suffix never shows.
    const trimmed = stdout?.trim();
    const message = trimmed && !trimmed.includes("\n") ? trimmed : undefined;
    const suffix = message ? ` - ${message}` : "";
    this.log.info(`Finished '${task.name}' after ${duration}s${suffix}`);

    this.timers.push({
      name: task.name,
      duration: `${duration}s`,
    });

    return stdout;
  }
}
