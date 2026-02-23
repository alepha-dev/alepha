import { stdin, stdout } from "node:process";
import { createInterface as createPromptInterface } from "node:readline/promises";
import { $inject, Alepha, AlephaError, type TSchema } from "alepha";
import { ConsoleColorProvider } from "alepha/logger";

/**
 * Clack-style interactive prompt renderer.
 *
 * Provides pretty enum selectors (arrow-key navigation),
 * text inputs, and confirm prompts with box-drawing framing.
 */
export class PrettyAsker {
  protected readonly alepha = $inject(Alepha);
  protected readonly color = $inject(ConsoleColorProvider);

  /**
   * Whether to use pretty mode.
   *
   * Same conditions as Runner.useDynamicLogger.
   */
  public get enabled(): boolean {
    if (this.alepha.isCI() || this.alepha.env.CLAUDECODE) {
      return false;
    }

    const logLevel = String(this.alepha.env.LOG_LEVEL || "").toLowerCase();
    if (logLevel === "debug" || logLevel === "trace") {
      return false;
    }

    return true;
  }

  // ---------------------------------------------------------------------------
  // Framing
  // ---------------------------------------------------------------------------

  /**
   * Print the opening frame with a title.
   */
  public intro(title: string): void {
    const c = this.color;
    this.write(`\n${c.set("DIM", "┌")}  ${c.set("BOLD", title)}\n`);
    this.write(`${c.set("DIM", "│")}\n`);
  }

  /**
   * Print the closing frame with a message.
   */
  public outro(message: string): void {
    const c = this.color;
    this.write(`${c.set("DIM", "│")}\n`);
    this.write(`${c.set("DIM", "└")}  ${message}\n\n`);
  }

  // ---------------------------------------------------------------------------
  // Select (arrow-key navigation)
  // ---------------------------------------------------------------------------

  /**
   * Arrow-key select prompt for enum schemas.
   */
  public async select(question: string, options: string[]): Promise<string> {
    let selectedIndex = 0;

    this.write(`${this.color.set("DIM", "│")}\n`);
    this.writeActiveMarker(question);
    this.renderOptions(options, selectedIndex);

    return new Promise<string>((resolve, reject) => {
      const hasRawMode = typeof stdin.setRawMode === "function";
      if (!hasRawMode) {
        // Fallback: no raw mode (piped stdin, etc.)
        this.clearOptions(options.length);
        this.writeCompletedMarker(question);
        this.writeAnswer(options[0]);
        resolve(options[0]);
        return;
      }

      stdin.setRawMode(true);
      stdin.resume();

      const onKeypress = (data: Buffer) => {
        const key = data.toString();

        // Ctrl+C
        if (key === "\x03") {
          cleanup();
          stdin.setRawMode(false);
          stdin.pause();
          reject(new AlephaError("Aborted."));
          return;
        }

        // Arrow up / k
        if (key === "\x1b[A" || key === "k") {
          selectedIndex = (selectedIndex - 1 + options.length) % options.length;
          this.clearOptions(options.length);
          this.renderOptions(options, selectedIndex);
          return;
        }

        // Arrow down / j
        if (key === "\x1b[B" || key === "j") {
          selectedIndex = (selectedIndex + 1) % options.length;
          this.clearOptions(options.length);
          this.renderOptions(options, selectedIndex);
          return;
        }

        // Enter
        if (key === "\r" || key === "\n") {
          cleanup();
          stdin.setRawMode(false);
          stdin.pause();

          // Clear options and replace with completed marker + answer
          this.clearOptions(options.length);
          this.clearActiveMarker();
          this.writeCompletedMarker(question);
          this.writeAnswer(options[selectedIndex]);

          resolve(options[selectedIndex]);
        }
      };

      const cleanup = () => {
        stdin.removeListener("data", onKeypress);
      };

      stdin.on("data", onKeypress);
    });
  }

  // ---------------------------------------------------------------------------
  // Text input
  // ---------------------------------------------------------------------------

  /**
   * Text input prompt with clack framing.
   */
  public async text(question: string, schema?: TSchema): Promise<string> {
    const c = this.color;
    const defaultValue =
      schema && "default" in schema ? String(schema.default) : undefined;

    this.write(`${c.set("DIM", "│")}\n`);
    this.writeActiveMarker(question);

    const defaultHint = defaultValue
      ? ` ${c.set("DIM", `(${defaultValue})`)}`
      : "";

    this.write(`${c.set("DIM", "│")}  ${c.set("DIM", ">")}${defaultHint} `);

    const rl = this.createPromptInterface();
    try {
      const answer = await rl.question("");
      const value = answer.trim() || defaultValue || "";

      // Move up to overwrite the input line
      this.write("\x1b[1A\x1b[2K");
      // Move up to overwrite the active marker
      this.clearActiveMarker();
      this.writeCompletedMarker(question);
      this.writeAnswer(value);

      if (schema) {
        return this.alepha.codec.decode(schema, value || undefined) as string;
      }
      return value;
    } finally {
      rl.close();
    }
  }

  // ---------------------------------------------------------------------------
  // Confirm (Y/n)
  // ---------------------------------------------------------------------------

  /**
   * Yes/No confirm prompt with clack framing.
   */
  public async confirm(question: string): Promise<boolean> {
    const c = this.color;

    this.write(`${c.set("DIM", "│")}\n`);
    this.writeActiveMarker(`${question} ${c.set("DIM", "(Y/n)")}`);
    this.write(`${c.set("DIM", "│")}  ${c.set("DIM", ">")} `);

    const rl = this.createPromptInterface();
    try {
      const answer = await rl.question("");
      const value = answer.trim().toLowerCase();
      const result = value !== "n" && value !== "no";

      // Move up to overwrite input
      this.write("\x1b[1A\x1b[2K");
      this.clearActiveMarker();
      this.writeCompletedMarker(question);
      this.writeAnswer(result ? "Yes" : "No");

      return result;
    } finally {
      rl.close();
    }
  }

  // ---------------------------------------------------------------------------
  // Rendering helpers
  // ---------------------------------------------------------------------------

  protected renderOptions(options: string[], selectedIndex: number): void {
    const c = this.color;
    for (let i = 0; i < options.length; i++) {
      const isSelected = i === selectedIndex;
      const marker = isSelected
        ? `${c.set("CYAN", "❯")} ${c.set("CYAN", options[i])}`
        : `  ${c.set("DIM", options[i])}`;
      this.write(`${c.set("DIM", "│")}  ${marker}\n`);
    }
  }

  protected clearOptions(count: number): void {
    for (let i = 0; i < count; i++) {
      this.write("\x1b[1A\x1b[2K");
    }
  }

  protected writeActiveMarker(question: string): void {
    this.write(`${this.color.set("CYAN", "◆")}  ${question}\n`);
  }

  protected clearActiveMarker(): void {
    this.write("\x1b[1A\x1b[2K");
  }

  protected writeCompletedMarker(question: string): void {
    this.write(`${this.color.set("DIM", "◇")}  ${question}\n`);
  }

  protected writeAnswer(value: string): void {
    this.write(
      `${this.color.set("DIM", "│")}  ${this.color.set("DIM", value)}\n`,
    );
  }

  protected write(str: string): void {
    stdout.write(str);
  }

  protected createPromptInterface() {
    return createPromptInterface({ input: stdin, output: stdout });
  }
}
