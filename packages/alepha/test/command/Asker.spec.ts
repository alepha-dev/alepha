import { Alepha, AlephaError, t } from "alepha";
import {
  LogDestinationProvider,
  MemoryDestinationProvider,
} from "alepha/logger";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { Asker } from "../../src/command";

describe("Asker", () => {
  let alepha: Alepha;
  let asker: Asker;
  let mockLogger: MemoryDestinationProvider;

  const mockPromptInterface = (answers: string[]) => {
    const question = vi.fn();
    for (const answer of answers) {
      question.mockResolvedValueOnce(answer);
    }
    const close = vi.fn();

    vi.spyOn(
      asker as unknown as { createPromptInterface: () => any },
      "createPromptInterface",
    ).mockReturnValue({
      question,
      close,
    });

    return { question, close };
  };

  beforeEach(() => {
    alepha = Alepha.create({
      env: {
        LOG_LEVEL: "info",
      },
    })
      .with({
        provide: LogDestinationProvider,
        use: MemoryDestinationProvider,
      })
      .with(Asker);

    asker = alepha.inject(Asker);
    mockLogger = alepha.inject(MemoryDestinationProvider);
    mockLogger.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("returns trimmed string when no schema is provided", async () => {
    const { question, close } = mockPromptInterface(["  hello world  "]);

    const result = await asker.ask("What is your name?");

    expect(result).toBe("hello world");
    expect(question).toHaveBeenCalledTimes(1);
    expect(question).toHaveBeenCalledWith("What is your name?\n> ");
    expect(close).toHaveBeenCalledTimes(1);
  });

  test("retries until schema validation passes", async () => {
    const { question, close } = mockPromptInterface(["abc", "41"]);

    const result = await asker.ask("Enter a number", {
      schema: t.number(),
    });

    expect(result).toBe(41);
    expect(question).toHaveBeenCalledTimes(2);
    expect(close).toHaveBeenCalledTimes(1);
    expect(mockLogger.logs.some((log) => log.level === "ERROR")).toBe(true);
  });

  test("uses schema defaults when the user provides an empty answer", async () => {
    const { question, close } = mockPromptInterface([""]);

    const result = await asker.ask("What is your favorite color?", {
      schema: t.text({ default: "blue" }),
    });

    expect(result).toBe("blue");
    expect(question).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
  });

  test("retries when custom validation throws an AlephaError", async () => {
    const { question, close } = mockPromptInterface(["wrong", "right"]);

    const result = await asker.ask("Provide the secret", {
      schema: t.text(),
      validate: (value) => {
        if (value !== "right") {
          throw new AlephaError("Invalid secret");
        }
      },
    });

    expect(result).toBe("right");
    expect(question).toHaveBeenCalledTimes(2);
    expect(close).toHaveBeenCalledTimes(1);

    const errorLogs = mockLogger.logs.filter((log) => log.level === "ERROR");
    expect(errorLogs).toHaveLength(1);
    expect(errorLogs[0].message).toContain("Invalid secret");
  });

  test("propagates unexpected errors without logging", async () => {
    const { question, close } = mockPromptInterface(["value"]);
    const unexpectedError = new Error("boom");

    await expect(
      asker.ask("Trigger failure", {
        schema: t.text(),
        validate: () => {
          throw unexpectedError;
        },
      }),
    ).rejects.toBe(unexpectedError);

    expect(question).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
    expect(mockLogger.logs.some((log) => log.level === "ERROR")).toBe(false);
  });
});
