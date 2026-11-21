import { Alepha } from "alepha";
import { describe, it } from "vitest";

import { ConsoleOutputProvider } from "../index.ts";

/**
 * Exposes the seams the real provider keeps to itself, so a test can assert
 * what a pipe would receive without owning a terminal.
 */
class TestOutputProvider extends ConsoleOutputProvider {
  public written: string[] = [];
  public tty = false;

  public override print(message = ""): void {
    this.written.push(this.colorEnabled() ? message : this.stripAnsi(message));
  }

  protected override colorEnabled(): boolean {
    return this.tty;
  }
}

/**
 * The provider's own reading of the process, which the class above replaces.
 */
class ProcessOutputProvider extends ConsoleOutputProvider {
  public testColorEnabled = () => this.colorEnabled();
}

const ESC = String.fromCharCode(27);
const RED = `${ESC}[31m`;
const RESET = `${ESC}[0m`;

const setup = () => {
  const alepha = Alepha.create({ env: { LOG_LEVEL: "error" } });
  return alepha.inject(TestOutputProvider);
};

describe("ConsoleOutputProvider", () => {
  it("keeps colour on a terminal", ({ expect }) => {
    const out = setup();
    out.tty = true;

    out.print(`${RED}hello${RESET}`);

    expect(out.written).toEqual([`${RED}hello${RESET}`]);
  });

  it("strips colour when the output is piped", ({ expect }) => {
    const out = setup();
    out.tty = false;

    out.print(`${RED}hello${RESET}`);

    // This is the property that makes output parseable: a caller doing
    // `cli something | grep` should not have to remove escape sequences.
    expect(out.written).toEqual(["hello"]);
  });

  it("reads the terminal and NO_COLOR from the process", ({ expect }) => {
    const out = Alepha.create({ env: { LOG_LEVEL: "error" } }).inject(
      ProcessOutputProvider,
    );
    const isTTY = process.stdout.isTTY;
    const noColor = process.env.NO_COLOR;

    try {
      process.stdout.isTTY = true;
      delete process.env.NO_COLOR;
      expect(out.testColorEnabled()).toBe(true);

      // NO_COLOR wins, even on a terminal.
      process.env.NO_COLOR = "1";
      expect(out.testColorEnabled()).toBe(false);

      delete process.env.NO_COLOR;
      process.stdout.isTTY = false;
      expect(out.testColorEnabled()).toBe(false);
    } finally {
      process.stdout.isTTY = isTTY;
      if (noColor === undefined) delete process.env.NO_COLOR;
      else process.env.NO_COLOR = noColor;
    }
  });

  it("leaves bracket text that is not an escape sequence alone", ({
    expect,
  }) => {
    const out = setup();
    out.tty = false;

    // The ESC is what makes it a colour code. Matching `[0m` on its own would
    // quietly eat real content out of a help document.
    out.print("see [0m in the docs");

    expect(out.written).toEqual(["see [0m in the docs"]);
  });

  it("strips every sequence in a line, not just the first", ({ expect }) => {
    const out = setup();
    out.tty = false;

    // The pattern is global, and one call does not carry over into the next.
    out.print(`${RED}a${RESET} ${RED}b${RESET}`);
    out.print(`${RED}c${RESET} ${RED}d${RESET}`);

    expect(out.written).toEqual(["a b", "c d"]);
  });

  it("prints an empty line when called with nothing", ({ expect }) => {
    const out = setup();

    out.print();

    expect(out.written).toEqual([""]);
  });
});
