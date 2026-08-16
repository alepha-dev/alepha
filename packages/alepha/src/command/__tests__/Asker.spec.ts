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
    asker.answers();

    await expect(asker.ask.prompt("Which template?")).rejects.toBeInstanceOf(
      NoInputError,
    );
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
});
