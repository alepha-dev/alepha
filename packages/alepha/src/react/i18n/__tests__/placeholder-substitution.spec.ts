import { Alepha } from "alepha";
import { describe, expect, it } from "vitest";
import { I18nProvider } from "../providers/I18nProvider.ts";

/**
 * `render` substituted placeholders with an ascending loop of
 * `result.replace("$" + (i + 1), args[i])`. Two things go wrong:
 *
 * - `$1` is replaced before `$10` is ever considered, so `$10` matches the
 *   `$1` pass and becomes `args[0] + "0"`.
 * - `String.prototype.replace` with a STRING pattern replaces only the first
 *   occurrence, so a placeholder used twice is substituted once.
 */
class Probe extends I18nProvider<any, any> {
  public substitute(template: string, args: string[]) {
    return (
      this as unknown as { render(t: string, a: string[]): string }
    ).render(template, args);
  }
}

const setup = async () => {
  const alepha = Alepha.create({ env: { LOG_LEVEL: "error" } });
  const probe = alepha.inject(Probe as never) as Probe;
  await alepha.start();
  return probe;
};

describe("i18n placeholder substitution", () => {
  it("substitutes single-digit placeholders", async () => {
    const probe = await setup();
    expect(
      probe.substitute("Hello $1, you have $2 messages", ["Ada", "3"]),
    ).toBe("Hello Ada, you have 3 messages");
  });

  it("does not let $1 eat $10", async () => {
    const probe = await setup();
    // Deliberately NOT `A1..A10`: with those values `"$10".replace("$1","A1")`
    // yields "A10" and the bug hides behind a coincidence.
    const args = [
      "one",
      "two",
      "three",
      "four",
      "five",
      "six",
      "seven",
      "eight",
      "nine",
      "ten",
    ];

    expect(probe.substitute("$10", args)).toBe("ten");
    expect(probe.substitute("$1 and $10", args)).toBe("one and ten");
    expect(probe.substitute("$2 $10 $1", args)).toBe("two ten one");
  });

  it("substitutes every occurrence of a repeated placeholder", async () => {
    const probe = await setup();
    expect(probe.substitute("$1 talks to $1 about $2", ["Ada", "math"])).toBe(
      "Ada talks to Ada about math",
    );
  });

  it("leaves a placeholder with no argument alone", async () => {
    const probe = await setup();
    expect(probe.substitute("Hello $1 and $2", ["Ada"])).toBe(
      "Hello Ada and $2",
    );
  });

  it("leaves a literal $ that is not a placeholder alone", async () => {
    const probe = await setup();
    expect(probe.substitute("Total: $ and $1", ["5"])).toBe("Total: $ and 5");
  });

  it("does not recursively substitute a value containing a placeholder", async () => {
    const probe = await setup();
    // A user-supplied value that happens to contain "$2" must be inserted
    // literally, not treated as another placeholder.
    expect(probe.substitute("$1 then $2", ["$2", "end"])).toBe("$2 then end");
  });

  it("returns the template unchanged when there are no arguments", async () => {
    const probe = await setup();
    expect(probe.substitute("Nothing to do", [])).toBe("Nothing to do");
  });
});
