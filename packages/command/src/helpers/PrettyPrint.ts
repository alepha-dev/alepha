export class PrettyPrint {
  private spinnerInterval?: NodeJS.Timeout;
  private readonly frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  private frameIndex = 0;

  // ANSI color codes
  private readonly colors = {
    reset: "\x1b[0m",
    cyan: "\x1b[36m",
    green: "\x1b[32m",
    red: "\x1b[31m",
    dim: "\x1b[2m",
  };

  /**
   * Start an animated spinner with a task name
   */
  public startSpinner(taskName: string): void {
    const updateSpinner = () => {
      process.stdout.write(
        `\r${this.colors.cyan}${this.frames[this.frameIndex]}${this.colors.reset} ${this.colors.dim}${taskName}${this.colors.reset}`,
      );
      this.frameIndex = (this.frameIndex + 1) % this.frames.length;
    };

    updateSpinner();
    this.spinnerInterval = setInterval(updateSpinner, 80);
  }

  /**
   * Stop the spinner and show success with a tick
   */
  public success(taskName: string, duration?: string): void {
    this.stopSpinner();
    const durationStr = duration
      ? ` ${this.colors.dim}${duration}${this.colors.reset}`
      : "";
    process.stdout.write(
      `\r${this.colors.green}✓${this.colors.reset} ${taskName}${durationStr}\n`,
    );
  }

  /**
   * Stop the spinner and show error with a cross
   */
  public error(taskName: string): void {
    this.stopSpinner();
    process.stdout.write(
      `\r${this.colors.red}✗${this.colors.reset} ${taskName}\n`,
    );
  }

  /**
   * Stop the spinner without showing any symbol
   */
  public stopSpinner(): void {
    if (this.spinnerInterval) {
      clearInterval(this.spinnerInterval);
      this.spinnerInterval = undefined;
      this.frameIndex = 0;
    }
  }
}
