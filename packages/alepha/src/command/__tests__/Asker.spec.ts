import { Alepha, AlephaError, z } from "alepha";
import {
  LogDestinationProvider,
  MemoryDestinationProvider,
} from "alepha/logger";
import { describe, expect, it } from "vitest";
import {
  $command,
  AlephaCommand,
  Asker,
  ConsoleOutputProvider,
  cliOptions,
  MemoryOutputProvider,
  NoInputError,
} from "../index.ts";

/**
 * Stands in for `readline`'s `Interface`, including the part that used to
 * break: once the answers run out, `question()` returns a promise that never
 * settles and the interface closes — exactly what the real one does at EOF.
 *
 * Reproducing that faithfully is the point. With a fake that simply resolved
 * `""` forever, the bug this file guards against (a command that prints its
 * question, does nothing, and exits 0) would not be reachable from a test.
 */
class FakeInterface {
  answers: string[];
  prompts: string[] = [];
  closeCount = 0;
  listeners = new Map<string, Set<(...args: any[]) => void>>();

  constructor(answers: string[]) {
    this.answers = [...answers];
  }

  question(prompt: string): Promise<string> {
    this.prompts.push(prompt);
    if (this.answers.length === 0) {
      queueMicrotask(() => this.close());
      return new Promise<string>(() => {});
    }
    return Promise.resolve(this.answers.shift() as string);
  }

  close(): void {
    if (this.closeCount > 0) return;
    this.closeCount++;
    for (const fn of this.listeners.get("close") ?? []) fn();
  }

  once(event: string, fn: (...args: any[]) => void): this {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)?.add(fn);
    return this;
  }

  off(event: string, fn: (...args: any[]) => void): this {
    this.listeners.get(event)?.delete(fn);
    return this;
  }
}

/**
 * Substitutes the terminal at the one seam that touches it, rather than
 * reaching for `vi.spyOn`.
 */
class TestAsker extends Asker {
  fake = new FakeInterface([]);
  createdCount = 0;
  testParseSelection = this.parseSelection.bind(this);

  answers(...answers: string[]): FakeInterface {
    this.fake = new FakeInterface(answers);
    return this.fake;
  }

  protected createPromptInterface(): any {
    this.createdCount++;
    return this.fake;
  }
}

const setup = (env: Record<string, string> = {}) => {
  const alepha = Alepha.create({ env: { LOG_LEVEL: "info", ...env } })
    .with({ provide: LogDestinationProvider, use: MemoryDestinationProvider })
    .with({ provide: ConsoleOutputProvider, use: MemoryOutputProvider })
    .with(TestAsker);

  const asker = alepha.inject(TestAsker);
  const logs = alepha.inject(MemoryDestinationProvider);
  const output = alepha.inject(MemoryOutputProvider);
  logs.clear();
  output.clear();

  return { alepha, asker, logs, output };
};

describe("Asker", () => {
  it("returns a trimmed string when no schema is given", async () => {
    const { asker } = setup();
    const fake = asker.answers("  hello world  ");

    expect(await asker.ask.prompt("What is your name?")).toBe("hello world");
    expect(fake.prompts).toEqual(["> "]);
  });

  it("prints the question instead of logging it", async () => {
    const { asker, logs, output } = setup();
    asker.answers("jack");

    await asker.ask.prompt("What is your name?");

    expect(output.text).toContain("What is your name?");
    expect(
      logs.logs.some((log) => log.message.includes("What is your name?")),
    ).toBe(false);
  });

  it("still asks when the log level silences info", async () => {
    const { asker, output } = setup({ LOG_LEVEL: "error" });
    asker.answers("jack");

    // The whole point of print(): an interactive command must not go silent
    // just because the caller turned the logs down, exactly like --help.
    expect(await asker.ask.prompt("What is your name?")).toBe("jack");
    expect(output.text).toContain("What is your name?");
  });

  it("retries until schema validation passes", async () => {
    const { asker, output } = setup();
    asker.answers("abc", "41");

    expect(
      await asker.ask.prompt("Enter a number", { schema: z.number() }),
    ).toBe(41);
    // The question is re-printed under the error, so the user can answer it again.
    expect(output.text.match(/Enter a number/g)).toHaveLength(2);
  });

  it("uses schema defaults when the answer is empty", async () => {
    const { asker } = setup();
    asker.answers("");

    const result = await asker.ask.prompt("What is your favorite color?", {
      schema: z.text({ default: "blue" }),
    });

    expect(result).toBe("blue");
  });

  it("accepts an empty answer for an optional schema", async () => {
    const { asker, output } = setup();
    const fake = asker.answers("");

    expect(
      await asker.ask.prompt("Middle name?", { schema: z.text().optional() }),
    ).toBeUndefined();

    // The bug this guards: `undefined` used to mean "retry", so an optional
    // field with an empty answer re-asked forever, printing no reason.
    expect(fake.prompts).toHaveLength(1);
    expect(output.text).not.toContain("Invalid");
  });

  it("retries when custom validation throws an AlephaError", async () => {
    const { asker, output } = setup();
    asker.answers("wrong", "right");

    const result = await asker.ask.prompt("Provide the secret", {
      schema: z.text(),
      validate: (value) => {
        if (value !== "right") throw new AlephaError("Invalid secret");
      },
    });

    expect(result).toBe("right");
    expect(output.text).toContain("Invalid secret");
  });

  it("propagates unexpected errors without printing them", async () => {
    const { asker, output } = setup();
    asker.answers("value");
    const unexpected = new Error("boom");

    await expect(
      asker.ask.prompt("Trigger failure", {
        schema: z.text(),
        validate: () => {
          throw unexpected;
        },
      }),
    ).rejects.toBe(unexpected);

    expect(output.text).not.toContain("boom");
  });

  it("frames a session with intro and outro", async () => {
    const { asker, output } = setup();

    asker.ask.intro("Create Alepha");
    asker.ask.outro("Project ready!");

    expect(output.text).toContain("Create Alepha");
    expect(output.text).toContain("Project ready!");
  });

  /**
   * The exact frame, asserted as a whole rather than as a handful of
   * `toContain`s. Every question used to sit directly on top of the `> ` the
   * answer was typed at and directly under the previous answer, so a three
   * question wizard came out as one block of text with no seam between what
   * was asked and what was replied.
   */
  it("frames every question with a blank line either side of the answer", async () => {
    const { asker, output } = setup();
    asker.answers("my-app", "2", "y");

    asker.ask.intro("Create Alepha");
    await asker.ask.prompt("What is your project name?");
    await asker.ask.choice(
      "Project shape:",
      [
        { value: "default", label: "default (API + web + Tailwind)" },
        { value: "saas", label: "saas (adds @alepha/ui)" },
      ],
      { default: "default" },
    );
    await asker.ask.confirm("Include @alepha/devtools?", { default: true });

    // The `> ` lines themselves are readline's, written straight to the
    // terminal rather than through the output provider, so they are absent
    // here — each gap below is where one goes.
    expect(output.lines).toEqual([
      "",
      "Create Alepha",
      "",
      "What is your project name?",
      "", // > my-app
      "",
      "Project shape:",
      "",
      "1. default (API + web + Tailwind) (default)",
      "2. saas (adds @alepha/ui)",
      "", // > 2
      "",
      "Include @alepha/devtools? [Y/n]",
      "", // > y
      "",
    ]);
  });

  it("separates a rejected answer's reason from the question it re-asks", async () => {
    const { asker, output } = setup();
    asker.answers("x", "y");

    await asker.ask.confirm("Delete everything?");

    expect(output.lines).toEqual([
      "Delete everything? [y/n]",
      "", // > x
      "",
      "Invalid answer, expected 'y' or 'n'",
      "",
      "Delete everything? [y/n]",
      "", // > y
      "",
    ]);
  });

  it("reuses one interface across questions", async () => {
    const { asker } = setup();
    const fake = asker.answers("first", "second");

    expect(await asker.ask.prompt("One?")).toBe("first");
    expect(await asker.ask.prompt("Two?")).toBe("second");

    expect(asker.createdCount).toBe(1);
    expect(fake.prompts).toEqual(["> ", "> "]);
    expect(fake.closeCount).toBe(0);
  });

  it("throws NoInputError instead of hanging when stdin ends", async () => {
    const { asker } = setup();
    const fake = asker.answers();

    await expect(asker.ask.prompt("Which template?")).rejects.toBeInstanceOf(
      NoInputError,
    );
    expect(fake.closeCount).toBe(1);
  });

  it("does not re-ask a question that stdin can never answer", async () => {
    const { asker } = setup();
    const fake = asker.answers();

    await expect(
      asker.ask.prompt("Pick one", { schema: z.enum(["a", "b"]) }),
    ).rejects.toBeInstanceOf(NoInputError);

    expect(fake.prompts).toHaveLength(1);
  });

  it("releases stdin when the command that asked is over", async () => {
    const alepha = Alepha.create({ env: { LOG_LEVEL: "info" } })
      .with({ provide: LogDestinationProvider, use: MemoryDestinationProvider })
      .with({ provide: ConsoleOutputProvider, use: MemoryOutputProvider })
      .with({ provide: Asker, use: TestAsker })
      .with(AlephaCommand)
      .with(
        class Commands {
          down = $command({
            name: "",
            description: "Asks, then finishes",
            handler: async ({ ask }) => {
              await ask.prompt('Type "staging" to confirm teardown:');
            },
          });
        },
      );

    alepha.store.mut(cliOptions, (old) => ({ ...old, argv: [] }));

    const asker = alepha.inject(Asker) as TestAsker;
    const fake = asker.answers("staging");

    // Commands run on `ready`; a CLI never reaches `stop`. The interface used
    // to be closed only by the `stop` hook, so `alepha platform down` kept a
    // ref'd handle on stdin and the process hung after doing all its work.
    await alepha.start();

    expect(fake.prompts).toHaveLength(1);
    expect(fake.closeCount).toBe(1);
  });

  it("releases stdin on stop", async () => {
    const { alepha, asker } = setup();
    const fake = asker.answers("done");

    // The only test here that needs the lifecycle: `stop` hooks do not run on
    // an app that was never started.
    await alepha.start();
    await asker.ask.prompt("Anything?");
    expect(fake.closeCount).toBe(0);

    await alepha.stop();

    // Held open, node would never exit: an open readline interface keeps a
    // ref'd handle on stdin.
    expect(fake.closeCount).toBe(1);
  });

  describe("confirm", () => {
    it("accepts every spelling of yes and no", async () => {
      const { asker } = setup();
      asker.answers("y", "YES", "n", "No");

      expect(await asker.ask.confirm("Delete everything?")).toBe(true);
      expect(await asker.ask.confirm("Delete everything?")).toBe(true);
      expect(await asker.ask.confirm("Delete everything?")).toBe(false);
      expect(await asker.ask.confirm("Delete everything?")).toBe(false);
    });

    it("shows which way an empty answer goes", async () => {
      const { asker, output } = setup();
      asker.answers("", "");

      expect(await asker.ask.confirm("Keep it?", { default: true })).toBe(true);
      expect(await asker.ask.confirm("Drop it?", { default: false })).toBe(
        false,
      );

      expect(output.text).toContain("Keep it? [Y/n]");
      expect(output.text).toContain("Drop it? [y/N]");
    });

    it("re-asks an empty answer when there is no default", async () => {
      const { asker, output } = setup();
      asker.answers("", "y");

      expect(await asker.ask.confirm("Proceed?")).toBe(true);
      expect(output.text).toContain("Proceed? [y/n]");
      expect(output.text.match(/Proceed\?/g)).toHaveLength(2);
    });

    it("re-asks on anything else", async () => {
      const { asker, output } = setup();
      asker.answers("x", "y");

      expect(await asker.ask.confirm("Delete everything?")).toBe(true);
      expect(output.text).toContain("Invalid answer, expected 'y' or 'n'");
    });
  });

  describe("choice", () => {
    it("returns the value behind the number", async () => {
      const { asker } = setup();
      asker.answers("2");

      expect(
        await asker.ask.choice("Choose your color:", ["red", "blue", "green"]),
      ).toBe("blue");
    });

    it("numbers the list from 1 and marks the default", async () => {
      const { asker, output } = setup();
      asker.answers("1");

      await asker.ask.choice("Choose your color:", ["red", "blue"], {
        default: "red",
      });

      expect(output.text).toContain("1. red (default)");
      expect(output.text).toContain("2. blue");
    });

    it("prints the label and returns the value", async () => {
      const { asker, output } = setup();
      asker.answers("2");

      const preset = await asker.ask.choice(
        "Project shape:",
        [
          { value: "default", label: "default (API + web + Tailwind)" },
          { value: "saas", label: "saas (adds @alepha/ui)" },
        ],
        { default: "default" },
      );

      expect(preset).toBe("saas");
      expect(output.text).toContain("2. saas (adds @alepha/ui)");
    });

    it("takes the default on an empty answer", async () => {
      const { asker } = setup();
      asker.answers("");

      expect(
        await asker.ask.choice("Choose your color:", ["red", "blue"], {
          default: "blue",
        }),
      ).toBe("blue");
    });

    it("re-asks an empty answer when there is no default", async () => {
      const { asker } = setup();
      asker.answers("", "1");

      expect(
        await asker.ask.choice("Choose your color:", ["red", "blue"]),
      ).toBe("red");
    });

    it("re-asks on 0, on past the end, and on a non-number", async () => {
      const { asker, output } = setup();
      asker.answers("0", "3", "red", "2");

      expect(
        await asker.ask.choice("Choose your color:", ["red", "blue"]),
      ).toBe("blue");
      expect(output.text).toContain(
        "Invalid answer, expected a number between 1 and 2",
      );
      expect(
        output.text.match(/Invalid answer, expected a number between 1 and 2/g),
      ).toHaveLength(3);
    });

    it("throws when the default is not one of the choices", async () => {
      const { asker } = setup();
      const fake = asker.answers();
      // Widened to string[], the way a CLI list built from config or a
      // directory listing would arrive, so the literal-tuple type parameter
      // cannot catch this at the call site either.
      const colors: string[] = ["red", "blue"];

      await expect(
        asker.ask.choice("Choose your color:", colors, { default: "purple" }),
      ).rejects.toBeInstanceOf(AlephaError);

      // Failed before ever asking, not after: nothing was printed.
      expect(fake.prompts).toHaveLength(0);
    });

    it("rejects an empty list of choices", async () => {
      const { asker, output } = setup();
      const fake = asker.answers();

      // Nothing in this list could ever satisfy `parse`: an empty answer
      // hits the no-default path, and every digit fails the range check
      // against a max of 0. Left unguarded, this is an unanswerable prompt.
      await expect(
        asker.ask.choice("Choose your color:", []),
      ).rejects.toBeInstanceOf(AlephaError);

      // Failed before ever asking, not after: nothing was printed.
      expect(fake.prompts).toHaveLength(0);
      expect(output.text).toBe("");
    });

    it("re-asks on a hex-looking answer instead of picking by it", async () => {
      const { asker, output } = setup();
      const fake = asker.answers("0x2", "2");

      expect(
        await asker.ask.choice("Choose your color:", ["red", "blue"]),
      ).toBe("blue");
      expect(output.text).toContain(
        "Invalid answer, expected a number between 1 and 2",
      );
      expect(fake.prompts).toHaveLength(2);
    });
  });

  describe("multiChoice", () => {
    it("accepts every separator form", () => {
      const { asker } = setup();

      // Straight from the spec. `-` is a SEPARATOR, not a range: "1-4-10" is
      // three items, never 1 through 4.
      for (const input of [
        "1 4 10",
        "1-4-10",
        "1,4,10",
        "1,-     4,,,,----       10",
      ]) {
        expect(asker.testParseSelection(input, 10)).toEqual([1, 4, 10]);
      }
    });

    it("deduplicates while keeping the order typed", () => {
      const { asker } = setup();

      expect(asker.testParseSelection("3 1 3 2", 3)).toEqual([3, 1, 2]);
    });

    it("rejects the whole answer when one token is out of range", () => {
      const { asker } = setup();

      expect(asker.testParseSelection("1 4", 3)).toBeUndefined();
      expect(asker.testParseSelection("0", 3)).toBeUndefined();
      expect(asker.testParseSelection("1 red", 3)).toBeUndefined();
      expect(asker.testParseSelection("1.5", 3)).toBeUndefined();
      expect(asker.testParseSelection("---", 3)).toBeUndefined();
      // Same digit guard `choice` uses: no hex, no exponent, no leading plus.
      expect(asker.testParseSelection("0x2", 3)).toBeUndefined();
      expect(asker.testParseSelection("+2", 3)).toBeUndefined();
    });

    it("rejects a default that is not one of the choices", async () => {
      const { asker, output } = setup();
      const fake = asker.answers("");

      await expect(
        asker.ask.multiChoice("Select features:", ["auth", "admin"], {
          default: ["nope"] as any,
        }),
      ).rejects.toBeInstanceOf(AlephaError);

      // Fails before anything is printed: a default nobody was offered is a
      // developer mistake, not something to ask the user about.
      expect(fake.prompts).toHaveLength(0);
      expect(output.text).toBe("");
    });

    it("rejects an empty list of choices", async () => {
      const { asker, output } = setup();
      const fake = asker.answers();

      await expect(
        asker.ask.multiChoice("Select features:", []),
      ).rejects.toBeInstanceOf(AlephaError);

      // Failed before ever asking, not after: nothing was printed.
      expect(fake.prompts).toHaveLength(0);
      expect(output.text).toBe("");
    });

    it("returns the selected values", async () => {
      const { asker } = setup();
      asker.answers("1, 3");

      expect(
        await asker.ask.multiChoice("Select features:", [
          "auth",
          "admin",
          "i18n",
        ]),
      ).toEqual(["auth", "i18n"]);
    });

    it("prints the hint under the list", async () => {
      const { asker, output } = setup();
      asker.answers("1");

      await asker.ask.multiChoice("Select features:", ["auth", "admin"]);

      expect(output.text).toContain(
        "Enter numbers separated by spaces, commas, semicolons, or dashes (a dash separates, not a range).",
      );
    });

    it("treats an empty answer as selecting nothing", async () => {
      const { asker } = setup();
      asker.answers("");

      expect(
        await asker.ask.multiChoice("Select features:", ["auth", "admin"]),
      ).toEqual([]);
    });

    it("takes the default on an empty answer when there is one", async () => {
      const { asker, output } = setup();
      asker.answers("");

      expect(
        await asker.ask.multiChoice("Select features:", ["auth", "admin"], {
          default: ["admin"],
        }),
      ).toEqual(["admin"]);
      expect(output.text).toContain("2. admin (default)");
    });

    it("re-asks a bad answer", async () => {
      const { asker, output } = setup();
      asker.answers("1 9", "2");

      expect(
        await asker.ask.multiChoice("Select features:", ["auth", "admin"]),
      ).toEqual(["admin"]);
      expect(output.text).toContain(
        "Invalid answer, expected a number between 1 and 2",
      );
    });
  });
});
