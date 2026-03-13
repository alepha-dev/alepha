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

    if (this.alepha.env.FORCE_COLOR) {
      return true;
    }

    if (this.alepha.isBrowser() && !navigator.userAgent.includes("Chrome")) {
      return false;
    }

    return !this.alepha.isProduction();
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
