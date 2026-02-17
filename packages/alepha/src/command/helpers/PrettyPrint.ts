import { $inject } from "alepha";
import { DateTimeProvider, type Interval } from "alepha/datetime";

export class PrettyPrint {
  protected dateTimeProvider = $inject(DateTimeProvider);
  protected spinnerInterval?: Interval;
  protected readonly frames = [
    "⠋",
    "⠙",
    "⠹",
    "⠸",
    "⠼",
    "⠴",
    "⠦",
    "⠧",
    "⠇",
    "⠏",
  ];
  protected tasks = new Map<
    string,
    {
      taskName: string;
      frameIndex: number;
      status: "running" | "success" | "error";
      startTime: number;
      duration?: string;
      message?: string;
    }
  >();
  protected lastLineCount = 0;
  protected header?: string;
  protected commandStartTime?: number;
  protected paused = false;

  // stdout interception
  protected originalStdoutWrite?: (...args: any[]) => boolean;
  protected bufferedOutput: string[] = [];
  protected isOwnWrite = false;

  // ANSI color codes
  protected readonly colors = {
    reset: "\x1b[0m",
    cyan: "\x1b[36m",
    green: "\x1b[32m",
    red: "\x1b[31m",
    dim: "\x1b[2m",
  };

  /**
   * Start a new command session with header
   */
  public startCommand(cliName: string, commandName: string): void {
    this.header = commandName ? `${cliName} ${commandName}` : cliName;
    this.commandStartTime = Date.now();
    this.tasks.clear();
    this.lastLineCount = 0;
    this.write(`┌─ ${this.header}\n`);
  }

  /**
   * End the command session with footer
   */
  public endCommand(): void {
    this.restoreStdout();
    if (this.commandStartTime) {
      const totalDuration = (
        (Date.now() - this.commandStartTime) /
        1000
      ).toFixed(1);
      this.write(`└─ Done in ${totalDuration}s\n`);
    }
    this.header = undefined;
    this.commandStartTime = undefined;
  }

  /**
   * Start an animated spinner with a task name
   */
  public startSpinner(id: string, taskName: string): void {
    this.tasks.set(id, {
      taskName,
      frameIndex: 0,
      status: "running",
      startTime: Date.now(),
    });

    this.interceptStdout();

    // Start interval if not already running
    if (!this.spinnerInterval) {
      this.spinnerInterval = this.dateTimeProvider.createInterval(
        () => this.updateDisplay(),
        80,
        true,
      );
    }

    this.updateDisplay();
  }

  /**
   * Stop the spinner and show success with a tick
   */
  public success(
    id: string,
    taskName?: string,
    duration?: string,
    message?: string,
  ): void {
    const task = this.tasks.get(id);
    if (task) {
      task.status = "success";
      if (taskName) task.taskName = taskName;
      if (duration) task.duration = duration;
      if (message) task.message = message;
      this.updateDisplay();
    }

    this.checkIfAllDone();
  }

  /**
   * Stop the spinner and show error with a cross
   */
  public error(id: string, taskName?: string): void {
    const task = this.tasks.get(id);
    if (task) {
      task.status = "error";
      if (taskName) task.taskName = taskName;
      this.updateDisplay();
    }

    this.checkIfAllDone();
    this.restoreStdout();
  }

  /**
   * Update the display for all tasks
   */
  protected updateDisplay(): void {
    // Clear previous spinner lines
    if (this.lastLineCount > 0) {
      for (let i = 0; i < this.lastLineCount; i++) {
        this.write("\x1b[1A\x1b[2K");
      }
    }

    // Flush buffered external output (appears permanently above spinner)
    if (this.bufferedOutput.length > 0) {
      for (const chunk of this.bufferedOutput) {
        this.write(chunk);
      }
      this.bufferedOutput = [];
    }

    // Render all tasks
    const taskArray = Array.from(this.tasks.values());
    const prefix = this.header ? "│  " : "";

    for (const task of taskArray) {
      let line = prefix;

      if (task.status === "running") {
        const frame = this.frames[task.frameIndex];
        const elapsed = String(
          Math.floor((Date.now() - task.startTime) / 100) / 10,
        ).padEnd(3, ".0");
        line += `${this.colors.cyan}${frame}${this.colors.reset} ${this.colors.dim}${task.taskName}${this.colors.reset}  ${this.colors.dim}${elapsed}s${this.colors.reset}`;
        task.frameIndex = (task.frameIndex + 1) % this.frames.length;
      } else if (task.status === "success") {
        const durationStr = task.duration
          ? `  ${this.colors.dim}${task.duration}${this.colors.reset}`
          : "";
        const messageStr = task.message ? ` - ${task.message}` : "";
        line += `${this.colors.green}✓${this.colors.reset} ${task.taskName}${durationStr}${messageStr}`;
      } else if (task.status === "error") {
        line += `${this.colors.red}✗${this.colors.reset} ${task.taskName}`;
      }

      this.write(`${line}\n`);
    }

    this.lastLineCount = taskArray.length;
  }

  /**
   * Check if all tasks are done and stop the interval
   */
  protected checkIfAllDone(): void {
    const hasRunningTasks = Array.from(this.tasks.values()).some(
      (task) => task.status === "running",
    );

    if (!hasRunningTasks && this.spinnerInterval) {
      this.dateTimeProvider.clearInterval(this.spinnerInterval);
      this.spinnerInterval = undefined;
    }
  }

  /**
   * Pause the spinner animation and restore stdout so external processes
   * (e.g. interactive login) can write to the terminal directly.
   */
  public pause(): void {
    if (this.paused) return;
    this.paused = true;

    // Stop the animation interval
    this.stopSpinner();

    // Clear spinner lines from screen so external output starts clean
    if (this.lastLineCount > 0) {
      for (let i = 0; i < this.lastLineCount; i++) {
        this.write("\x1b[1A\x1b[2K");
      }
      this.lastLineCount = 0;
    }

    // Close the box before external output
    if (this.header) {
      this.write("└───\n\n");
    }

    this.restoreStdout();
  }

  /**
   * Resume the spinner animation after a pause.
   */
  public resume(): void {
    if (!this.paused) return;
    this.paused = false;

    // Reopen the box after external output
    if (this.header) {
      this.write("\n┌───\n");
    }

    this.interceptStdout();

    const hasRunningTasks = Array.from(this.tasks.values()).some(
      (task) => task.status === "running",
    );

    if (hasRunningTasks) {
      this.updateDisplay();

      if (!this.spinnerInterval) {
        this.spinnerInterval = this.dateTimeProvider.createInterval(
          () => this.updateDisplay(),
          80,
          true,
        );
      }
    }
  }

  /**
   * Stop the spinner without showing any symbol
   */
  public stopSpinner(): void {
    if (this.spinnerInterval) {
      this.dateTimeProvider.clearInterval(this.spinnerInterval);
      this.spinnerInterval = undefined;
    }
  }

  /**
   * Clear all tasks
   */
  public clear(): void {
    this.tasks.clear();
    this.stopSpinner();
    this.restoreStdout();
    this.lastLineCount = 0;
  }

  // ---------------------------------------------------------------------------
  // stdout interception
  // ---------------------------------------------------------------------------

  /**
   * Intercept process.stdout.write so external writes (logs, wrangler output)
   * are buffered instead of breaking the spinner animation. Buffered output is
   * flushed above the spinner area on each redraw.
   */
  protected interceptStdout(): void {
    if (this.originalStdoutWrite) return;

    const original = process.stdout.write.bind(process.stdout);
    this.originalStdoutWrite = original;

    process.stdout.write = ((
      chunk: any,
      encodingOrCb?: any,
      cb?: any,
    ): boolean => {
      if (this.isOwnWrite) {
        return original(chunk, encodingOrCb, cb);
      }
      this.bufferedOutput.push(String(chunk));
      return true;
    }) as typeof process.stdout.write;
  }

  /**
   * Restore the original process.stdout.write and flush remaining buffer.
   */
  protected restoreStdout(): void {
    if (!this.originalStdoutWrite) return;

    const original = this.originalStdoutWrite;
    this.originalStdoutWrite = undefined;
    process.stdout.write = original as typeof process.stdout.write;

    for (const chunk of this.bufferedOutput) {
      original(chunk);
    }
    this.bufferedOutput = [];
  }

  /**
   * Write to stdout bypassing the intercept.
   */
  protected write(str: string): void {
    this.isOwnWrite = true;
    process.stdout.write(str);
    this.isOwnWrite = false;
  }
}
