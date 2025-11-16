import { $env, $inject, Alepha, t } from "alepha";

const envSchema = t.object({
  /**
   * Disable colors in the console output.
   */
  NO_COLOR: t.optional(t.text()),

  /**
   * Force color output for the application.
   */
  FORCE_COLOR: t.optional(t.text()),
});

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
    // levels
    SILENT: "",
    ERROR: "\x1b[31m",
    WARN: "\x1b[33m",
    INFO: "\x1b[32m",
    DEBUG: "\x1b[34m",
    TRACE: "\x1b[90m",
  };

  protected readonly env = $env(envSchema);
  protected readonly alepha = $inject(Alepha);

  protected enabled = true;

  constructor() {
    this.enabled = this.isEnabled();
  }

  public isEnabled(): boolean {
    if (this.env.NO_COLOR) {
      return false;
    }

    if (this.env.FORCE_COLOR) {
      return true;
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
