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
      duration?: string;
    }
  >();
  protected lastLineCount = 0;

  // ANSI color codes
  protected readonly colors = {
    reset: "\x1b[0m",
    cyan: "\x1b[36m",
    green: "\x1b[32m",
    red: "\x1b[31m",
    dim: "\x1b[2m",
  };

  /**
   * Start an animated spinner with a task name
   */
  public startSpinner(id: string, taskName: string): void {
    this.tasks.set(id, {
      taskName,
      frameIndex: 0,
      status: "running",
    });

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
  public success(id: string, taskName?: string, duration?: string): void {
    const task = this.tasks.get(id);
    if (task) {
      task.status = "success";
      if (taskName) task.taskName = taskName;
      if (duration) task.duration = duration;
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
  }

  /**
   * Update the display for all tasks
   */
  protected updateDisplay(): void {
    // Clear previous lines
    if (this.lastLineCount > 0) {
      // Move cursor up and clear each line
      for (let i = 0; i < this.lastLineCount; i++) {
        process.stdout.write("\x1b[1A\x1b[2K");
      }
    }

    // Render all tasks
    const taskArray = Array.from(this.tasks.values());
    for (const task of taskArray) {
      let line = "";

      if (task.status === "running") {
        const frame = this.frames[task.frameIndex];
        line = `${this.colors.cyan}${frame}${this.colors.reset} ${this.colors.dim}${task.taskName}${this.colors.reset}`;
        task.frameIndex = (task.frameIndex + 1) % this.frames.length;
      } else if (task.status === "success") {
        const durationStr = task.duration
          ? ` ${this.colors.dim}${task.duration}${this.colors.reset}`
          : "";
        line = `${this.colors.green}✓${this.colors.reset} ${task.taskName}${durationStr}`;
      } else if (task.status === "error") {
        line = `${this.colors.red}✗${this.colors.reset} ${task.taskName}`;
      }

      process.stdout.write(`${line}\n`);
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
    this.lastLineCount = 0;
  }
}
