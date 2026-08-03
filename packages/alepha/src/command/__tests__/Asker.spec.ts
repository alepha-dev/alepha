import { Alepha, AlephaError, z } from "alepha";
import {
  LogDestinationProvider,
  MemoryDestinationProvider,
} from "alepha/logger";
import { describe, expect, it } from "vitest";
import { Asker, NoInputError } from "../index.ts";

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

const setup = () => {
  const alepha = Alepha.create({ env: { LOG_LEVEL: "info" } })
    .with({ provide: LogDestinationProvider, use: MemoryDestinationProvider })
    .with(TestAsker);

  const asker = alepha.inject(TestAsker);
  const logs = alepha.inject(MemoryDestinationProvider);
  logs.clear();

  return { alepha, asker, logs };
};

describe("Asker", () => {
  it("returns a trimmed string when no schema is given", async () => {
    const { asker } = setup();
    const fake = asker.answers("  hello world  ");

    expect(await asker.ask("What is your name?")).toBe("hello world");
    expect(fake.prompts).toEqual(["> "]);
  });

  it("retries until schema validation passes", async () => {
    const { asker, logs } = setup();
    asker.answers("abc", "41");

    expect(await asker.ask("Enter a number", { schema: z.number() })).toBe(41);
    expect(logs.logs.some((log) => log.level === "ERROR")).toBe(true);
  });

  it("uses schema defaults when the answer is empty", async () => {
    const { asker } = setup();
    asker.answers("");

    const result = await asker.ask("What is your favorite color?", {
      schema: z.text({ default: "blue" }),
    });

    expect(result).toBe("blue");
  });

  it("retries when custom validation throws an AlephaError", async () => {
    const { asker, logs } = setup();
    asker.answers("wrong", "right");

    const result = await asker.ask("Provide the secret", {
      schema: z.text(),
      validate: (value) => {
        if (value !== "right") throw new AlephaError("Invalid secret");
      },
    });

    expect(result).toBe("right");
    const errors = logs.logs.filter((log) => log.level === "ERROR");
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain("Invalid secret");
  });

  it("propagates unexpected errors without logging them", async () => {
    const { asker, logs } = setup();
    asker.answers("value");
    const unexpected = new Error("boom");

    await expect(
      asker.ask("Trigger failure", {
        schema: z.text(),
        validate: () => {
          throw unexpected;
        },
      }),
    ).rejects.toBe(unexpected);

    expect(logs.logs.some((log) => log.level === "ERROR")).toBe(false);
  });

  it("reuses one interface across questions", async () => {
    const { asker } = setup();
    const fake = asker.answers("first", "second");

    expect(await asker.ask("One?")).toBe("first");
    expect(await asker.ask("Two?")).toBe("second");

    // One interface, two prompts. It used to be one interface per question,
    // each closed straight after — and since readline buffers ahead, the first
    // close swallowed the rest of stdin, so `printf 'a\nb\n' | cli` answered
    // the first question and met EOF on the second.
    expect(asker.createdCount).toBe(1);
    expect(fake.prompts).toEqual(["> ", "> "]);
    expect(fake.closeCount).toBe(0);
  });

  it("throws NoInputError instead of hanging when stdin ends", async () => {
    const { asker } = setup();
    asker.answers(); // nothing to read — EOF on the first question

    // The regression: `rl.question()` never settles at EOF, so `ask()` never
    // returned, the event loop emptied and node exited 0. A command reported
    // success having created nothing.
    await expect(asker.ask("Which template?")).rejects.toBeInstanceOf(
      NoInputError,
    );
  });

  it("does not re-ask a question that stdin can never answer", async () => {
    const { asker } = setup();
    const fake = asker.answers();

    await expect(
      asker.ask("Pick one", { schema: z.enum(["a", "b"]) }),
    ).rejects.toBeInstanceOf(NoInputError);

    // A schema failure re-asks; an EOF must not, or it would spin forever
    // against a stream that has nothing left to give.
    expect(fake.prompts).toHaveLength(1);
  });

  it("releases stdin on stop", async () => {
    const { alepha, asker } = setup();
    const fake = asker.answers("done");

    // The only test here that needs the lifecycle: `stop` hooks do not run on
    // an app that was never started.
    await alepha.start();
    await asker.ask("Anything?");
    expect(fake.closeCount).toBe(0);

    await alepha.stop();

    // Held open, node would never exit: an open readline interface keeps a
    // ref'd handle on stdin.
    expect(fake.closeCount).toBe(1);
  });
});
