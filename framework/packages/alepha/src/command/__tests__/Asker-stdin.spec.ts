import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline/promises";
import { PassThrough } from "node:stream";
import { fileURLToPath } from "node:url";

import { Alepha, AlephaError } from "alepha";
import { describe, it } from "vitest";

import { Asker } from "../helpers/Asker.ts";
import { ConsoleOutputProvider } from "../providers/ConsoleOutputProvider.ts";
import { MemoryOutputProvider } from "../providers/MemoryOutputProvider.ts";

const here = dirname(fileURLToPath(import.meta.url));
const child = join(here, "fixtures", "asker-child.ts");

interface Report {
  answers: string[];
  failure?: { noInput: boolean; code?: string; message: string };
}

/**
 * The real `readline` over a real pipe, in a child process: the fake
 * interface of Asker.spec.ts hands out one answer per `question()` call,
 * which a pipe does not. It delivers every line it holds at once.
 */
describe("Asker on piped stdin", () => {
  const ask = (
    stdin: string,
    questions: string[],
    env: Record<string, string> = {},
  ): Promise<Report> =>
    new Promise((resolve, reject) => {
      const proc = spawn(process.execPath, [child, ...questions], {
        env: { ...process.env, ...env },
        stdio: ["pipe", "ignore", "pipe"],
      });
      let err = "";
      proc.stderr.on("data", (chunk) => {
        err += String(chunk);
      });
      proc.on("error", reject);
      proc.on("close", (code) => {
        const line = err.split("\n").findLast((it) => it.startsWith("{"));
        if (code !== 0 || !line) {
          reject(new AlephaError(`child exited ${code}: ${err}`));
          return;
        }
        resolve(JSON.parse(line) as Report);
      });
      proc.stdin.end(stdin);
    });

  it("answers every question from lines piped in one chunk", async ({
    expect,
  }) => {
    const report = await ask("a\nb\nc\n", ["One?", "Two?", "Three?"]);

    expect(report).toEqual({ answers: ["a", "b", "c"] });
  });

  it("says there is no input when the lines run out", async ({ expect }) => {
    const report = await ask("a\nb\n", ["One?", "Two?", "Three?"]);

    expect(report.answers).toEqual(["a", "b"]);
    expect(report.failure?.noInput).toBe(true);
  });

  it("says there is no input when stdin ended between two questions", async ({
    expect,
  }) => {
    const report = await ask("a\n", ["One?", "Two?"], {
      ASKER_WAIT_FOR_END: "1",
    });

    expect(report.answers).toEqual(["a"]);
    expect(report.failure).toEqual({
      noInput: true,
      message: expect.stringContaining("Pass the value as a flag"),
    });
  });
});

/**
 * The real `readline` over a stream the spec writes to, for what a child
 * process cannot show: what the asker keeps, and a terminal.
 */
class StreamAsker extends Asker {
  public readonly stdin = new PassThrough();
  public terminal = false;

  public get unreadCount(): number {
    return this.unread.length;
  }

  protected override createPromptInterface() {
    return createInterface({ input: this.stdin, output: new PassThrough() });
  }

  protected override inputIsTerminal(): boolean {
    return this.terminal;
  }
}

describe("Asker on a real readline", () => {
  const setup = () =>
    Alepha.create({ env: { LOG_LEVEL: "error" } })
      .with({ provide: ConsoleOutputProvider, use: MemoryOutputProvider })
      .inject(StreamAsker);

  it("keeps a bounded number of unread lines from a pipe that never stops", async ({
    expect,
  }) => {
    const asker = setup();

    const first = asker.ask.prompt("Sure?");
    asker.stdin.write("y\n".repeat(1500));

    expect(await first).toBe("y");
    expect(asker.unreadCount).toBe(1000);
    expect(await asker.ask.prompt("Really?")).toBe("y");
    expect(asker.unreadCount).toBe(999);

    asker.close();
  });

  it("does not answer a question with a line typed at a terminal before it was asked", async ({
    expect,
  }) => {
    const asker = setup();
    asker.terminal = true;

    const first = asker.ask.prompt("One?");
    asker.stdin.write("a\nstray\n");
    expect(await first).toBe("a");
    expect(asker.unreadCount).toBe(0);

    const second = asker.ask.prompt("Two?");
    asker.stdin.write("b\n");
    expect(await second).toBe("b");

    asker.close();
  });
});
