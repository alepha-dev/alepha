import { $inject } from "alepha";
import { ConsoleColorProvider } from "alepha/logger";

/**
 * What a command *produces*, as opposed to what it *reports*.
 *
 * Two different things shared one stream: `ConsoleDestinationProvider` logs
 * through `console.log`, so `alepha --version` came back as a timestamped,
 * coloured, two-line log entry — 112 bytes where a script wanted `0.24.0`.
 * Worse, its shape followed `LOG_FORMAT`, an environment variable the script
 * does not control, so a parser written against one format broke under another.
 *
 * `printHelp` had already hit this and worked around it by flipping
 * `alepha.logger.format` to `raw` and restoring it afterwards — a global
 * mutation whose own comment records the bug it caused ("flipping the format
 * permanently made every later log lose its timestamp and level"). That
 * workaround also cannot fix scripting: changing the format changes how a line
 * *looks*, not which stream it goes to.
 *
 * So output is written here, straight to stdout, never through the logger. The
 * logger keeps narrating; this prints results.
 *
 * Colour is dropped when stdout is not a TTY, which is what makes the output
 * pipeable without the caller stripping escape sequences by hand. `NO_COLOR`
 * is honoured for the same reason.
 */
export class ConsoleOutputProvider {
  protected readonly color = $inject(ConsoleColorProvider);

  /**
   * SGR escape sequences, as emitted by `ConsoleColorProvider`.
   *
   * Built from `String.fromCharCode(27)` instead of a literal ESC in the
   * source. A raw control character is invisible in an editor, survives
   * editing badly, and is rejected outright by some tooling. The ESC also has
   * to be part of the pattern — matching only `[0-9;]*m` would eat literal
   * text like `[0m` out of a help string.
   */
  protected readonly ansi = new RegExp(
    `${String.fromCharCode(27)}\\[[0-9;]*m`,
    "g",
  );

  /**
   * Write one line to stdout.
   *
   * Falls back to `console.log` where there is no `process` — workerd and the
   * browser, where a CLI has no business running anyway, but the logger guards
   * the same way and this should not be the thing that throws.
   */
  public print(message = ""): void {
    const line = this.colorEnabled() ? message : this.stripAnsi(message);

    if (typeof process === "object" && process.stdout?.write) {
      process.stdout.write(`${line}\n`);
      return;
    }

    console.log(line);
  }

  /**
   * Whether stdout can render escape sequences.
   *
   * A pipe or a file cannot, and a caller who asked for `NO_COLOR` does not
   * want to.
   */
  protected colorEnabled(): boolean {
    if (typeof process !== "object") return false;
    if (process.env.NO_COLOR) return false;
    return !!process.stdout?.isTTY;
  }

  /**
   * Strip colour.
   *
   * Call sites colour their strings before handing them over — `printHelp`
   * builds a whole document that way — so the colour has to come back out
   * here rather than being conditionally applied upstream.
   */
  protected stripAnsi(message: string): string {
    // `lastIndex` is shared state on a global regex; reset it so two calls in
    // a row cannot start mid-string.
    this.ansi.lastIndex = 0;
    return message.replace(this.ansi, "");
  }
}
