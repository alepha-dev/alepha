import { Alepha } from "alepha";
import { describe, expect, it } from "vitest";
import { ConsoleOutputProvider } from "../index.ts";

/**
 * Exposes the seams the real provider keeps to itself, so a test can assert
 * what a pipe would receive without owning a terminal.
 */
class TestOutputProvider extends ConsoleOutputProvider {
  public written: string[] = [];
  public tty = false;
  public noColor = false;

  public override print(message = ""): void {
    this.written.push(this.colorEnabled() ? message : this.stripAnsi(message));
  }

  protected override colorEnabled(): boolean {
    return this.tty && !this.noColor;
  }
}

const ESC = String.fromCharCode(27);
const RED = `${ESC}[31m`;
const RESET = `${ESC}[0m`;

const setup = () => {
  const alepha = Alepha.create({ env: { LOG_LEVEL: "error" } });
  return alepha.inject(TestOutputProvider);
};

describe("ConsoleOutputProvider", () => {
  it("keeps colour on a terminal", () => {
    const out = setup();
    out.tty = true;

    out.print(`${RED}hello${RESET}`);

    expect(out.written).toEqual([`${RED}hello${RESET}`]);
  });

  it("strips colour when the output is piped", () => {
    const out = setup();
    out.tty = false;

    out.print(`${RED}hello${RESET}`);

    // This is the property that makes output parseable: a caller doing
    // `cli something | grep` should not have to remove escape sequences.
    expect(out.written).toEqual(["hello"]);
  });

  it("strips colour when NO_COLOR is set, even on a terminal", () => {
    const out = setup();
    out.tty = true;
    out.noColor = true;

    out.print(`${RED}hello${RESET}`);

    expect(out.written).toEqual(["hello"]);
  });

  it("leaves bracket text that is not an escape sequence alone", () => {
    const out = setup();
    out.tty = false;

    // The ESC is what makes it a colour code. Matching `[0m` on its own would
    // quietly eat real content out of a help document.
    out.print("see [0m in the docs");

    expect(out.written).toEqual(["see [0m in the docs"]);
  });

  it("strips every sequence in a line, not just the first", () => {
    const out = setup();
    out.tty = false;

    // Guards the shared `lastIndex` of the global regex: left unreset, a second
    // call resumes mid-string and misses matches.
    out.print(`${RED}a${RESET} ${RED}b${RESET}`);
    out.print(`${RED}c${RESET} ${RED}d${RESET}`);

    expect(out.written).toEqual(["a b", "c d"]);
  });

  it("prints an empty line when called with nothing", () => {
    const out = setup();

    out.print();

    expect(out.written).toEqual([""]);
  });
});
