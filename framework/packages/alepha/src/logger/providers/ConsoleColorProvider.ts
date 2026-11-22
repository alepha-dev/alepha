import { $inject, Alepha } from "alepha";

export class ConsoleColorProvider {
  static readonly COLORS = {
    RESET: "\x1b[0m",
    BLACK: "\x1b[30m",
    RED: "\x1b[31m",
    GREEN: "\x1b[32m",
    ORANGE: "\x1b[33m", // using yellow for orange-ish
    BLUE: "\x1b[34m",
    PURPLE: "\x1b[35m",
    CYAN: "\x1b[36m",
    GREY_LIGHT: "\x1b[37m",
    GREY_LIGHT_BOLD: "\x1b[1;37m",
    GREY_DARK: "\x1b[90m",
    GREY_DARK_BOLD: "\x1b[1;90m",
    WHITE: "\x1b[97m",
    WHITE_BOLD: "\x1b[1;97m",
    // modifiers
    DIM: "\x1b[2m",
    BOLD: "\x1b[1m",
    INVERSE: "\x1b[7m",
    // levels
    SILENT: "",
    ERROR: "\x1b[31m",
    WARN: "\x1b[33m",
    INFO: "\x1b[32m",
    DEBUG: "\x1b[34m",
    TRACE: "\x1b[90m",
  };

  protected readonly alepha = $inject(Alepha);

  protected enabled = true;

  constructor() {
    this.enabled = this.isEnabled();
  }

  public isEnabled(): boolean {
    if (this.alepha.env.NO_COLOR) {
      return false;
    }

    // `FORCE_COLOR=0` means "off" (the chalk/Node convention), not "on".
    if (this.alepha.isEnvEnabled("FORCE_COLOR")) {
      return true;
    }

    if (this.alepha.isBrowser()) {
      return (
        navigator.userAgent.includes("Chrome") && !this.alepha.isProduction()
      );
    }

    // A server writing to a file or a pipe (`yarn dev > dev.log`, an agent's
    // background task, CI) gets plain text: escape codes there only cost
    // whoever reads or greps the log. `FORCE_COLOR` above still turns them on.
    if (!this.isTerminal()) {
      return false;
    }

    return !this.alepha.isProduction();
  }

  /**
   * Whether stdout is an interactive terminal. False on a runtime with no
   * `process.stdout` (workerd), where output goes to a log collector.
   */
  protected isTerminal(): boolean {
    return typeof process !== "undefined" && !!process.stdout?.isTTY;
  }

  public set(
    color: keyof typeof ConsoleColorProvider.COLORS,
    text: string,
    reset: string = ConsoleColorProvider.COLORS.RESET,
  ): string {
    if (!this.enabled) {
      return text;
    }

    return `${ConsoleColorProvider.COLORS[color]}${text}${reset}`;
  }
}
