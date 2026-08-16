import { stdin as input, stdout as output } from "node:process";
import type { Interface } from "node:readline/promises";
import { createInterface as createPromptInterface } from "node:readline/promises";
import {
  $hook,
  $inject,
  Alepha,
  AlephaError,
  coerceScalar,
  type Infer,
  type ZodString,
  type ZType,
} from "alepha";
import { ConsoleColorProvider } from "alepha/logger";
import { NoInputError } from "../errors/NoInputError.ts";
import { ConsoleOutputProvider } from "../providers/ConsoleOutputProvider.ts";

export interface AskOptions<T extends ZType = ZodString> {
  /**
   * Response schema expected.
   *
   * Recommended schemas:
   * - z.text() - for free text input
   * - z.number() - for numeric input
   * - z.enum(["option1", "option2"]) - for predefined options
   *
   * You can use schema.default to provide a default value.
   *
   * @example
   * ```ts
   * ask.prompt("What is your name?", { schema: z.text({ default: "John Doe" }) })
   * ```
   *
   * @default ZodString
   */
  schema?: T;

  /**
   * Custom validation function.
   * Throws an AlephaError in case of validation failure.
   */
  validate?: (value: Infer<T>) => void;
}

export interface AskMethods {
  /**
   * Ask for a free-form value, decoded through a schema.
   */
  prompt<T extends ZType = ZodString>(
    question: string,
    options?: AskOptions<T>,
  ): Promise<Infer<T>>;

  intro(title: string): void;
  outro(message: string): void;
}

/**
 * Reads interactive input from the terminal using plain readline prompts.
 *
 * One straightforward code path: questions are printed to stdout and answers
 * are read with Node's `readline`. No raw-mode cursor control, no ANSI framing
 * beyond colour, so output stays greppable and works the same in a TTY, under
 * CI, or when piped.
 *
 * Questions go through {@link ConsoleOutputProvider}, not the logger. A
 * question is what the command *produces* while it waits, not what it
 * *reports*: routed through `$logger` it carried a timestamp and a level, and
 * it vanished entirely under `LOG_LEVEL=error`, leaving an interactive command
 * sitting at a prompt it had never shown.
 */
export class Asker {
  public readonly ask: AskMethods;

  protected readonly output = $inject(ConsoleOutputProvider);
  protected readonly color = $inject(ConsoleColorProvider);
  protected readonly alepha = $inject(Alepha);

  /**
   * One interface for the whole session, created on the first question.
   *
   * It used to be one per question, closed straight after. That silently broke
   * piped input: readline buffers ahead, so the first `close()` took the rest
   * of stdin with it and every later question met EOF. `printf 'a\nb\n' | cli`
   * answered question one and lost question two.
   */
  protected rl?: Interface;

  constructor() {
    this.ask = this.createAskMethods();
  }

  /**
   * Release stdin so the process can exit.
   *
   * Holding an open readline interface keeps a `ref`'d handle on stdin, and
   * node stays alive on it forever.
   *
   * Idempotent, and safe to call before another question: the next question
   * simply opens a fresh interface.
   */
  public close(): void {
    this.rl?.close();
    this.rl = undefined;
  }

  protected readonly onStop = $hook({
    on: "stop",
    handler: () => this.close(),
  });

  protected createAskMethods(): AskMethods {
    return {
      prompt: <T extends ZType = ZodString>(
        question: string,
        options: AskOptions<T> = {},
      ) => this.promptValue<T>(question, options),

      intro: (title: string) => this.printIntro(title),
      outro: (message: string) => this.printOutro(message),
    };
  }

  /**
   * Ask one question until the answer parses, then return it.
   *
   * `render` prints the question (and whatever goes with it) on every attempt,
   * so a rejected answer is followed by the question again rather than a bare
   * `>`. `parse` returns `undefined` to mean "not valid, ask again", and is
   * responsible for having printed the reason.
   *
   * Every question type in this class goes through here, which is what makes
   * the EOF handling below cost one implementation instead of four.
   */
  protected async loop<V>(
    render: () => void,
    parse: (answer: string) => V | undefined,
  ): Promise<V> {
    const rl = this.getPromptInterface();
    try {
      for (;;) {
        render();
        const answer = await this.readLine(rl);
        const value = parse(answer.trim());
        if (value !== undefined) {
          return value;
        }
      }
    } catch (error) {
      // The interface is shared for the whole session, so it is closed on
      // `stop` rather than here — except on EOF, where there is nothing left
      // to read and holding it open only delays the exit.
      if (error instanceof NoInputError) {
        this.close();
      }
      throw error;
    }
  }

  protected promptValue<T extends ZType = ZodString>(
    question: string,
    options: AskOptions<T>,
  ): Promise<Infer<T>> {
    return this.loop<Infer<T>>(
      () => this.printQuestion(question),
      (answer) => {
        try {
          let value: any;
          if (options.schema) {
            // The terminal is a string-only boundary (like HTTP query/env), so
            // coerce the answer to the schema's scalar type before strict
            // decoding — otherwise `z.number()` would reject the string "41".
            const raw = answer ? answer : undefined;
            value = this.alepha.codec.decode(
              options.schema,
              raw === undefined ? undefined : coerceScalar(options.schema, raw),
            );
          } else {
            value = answer;
          }
          if (options.validate) {
            options.validate(value);
          }
          return value;
        } catch (error) {
          if (error instanceof AlephaError) {
            this.printError(error.message);
            return undefined;
          }
          throw error;
        }
      },
    );
  }

  protected printIntro(title: string): void {
    this.output.print();
    this.output.print(this.color.set("WHITE_BOLD", title));
    this.output.print();
  }

  protected printOutro(message: string): void {
    if (message) {
      this.output.print(message);
    }
    this.output.print();
  }

  protected printQuestion(question: string): void {
    this.output.print(this.color.set("WHITE_BOLD", question));
  }

  protected printError(message: string): void {
    this.output.print(this.color.set("RED", message));
  }

  protected printHint(message: string): void {
    this.output.print(this.color.set("GREY_DARK", message));
  }

  protected getPromptInterface(): Interface {
    this.rl ??= this.createPromptInterface();
    return this.rl;
  }

  protected createPromptInterface(): Interface {
    return createPromptInterface({ input, output });
  }

  /**
   * Read one line, or fail loudly when stdin has ended.
   *
   * `rl.question()` on a closed stream returns a promise that never settles.
   * Left alone, the event loop empties and node exits **0** — the command
   * reports success having done nothing at all. Racing the interface's `close`
   * event turns that silent no-op into an error.
   */
  protected readLine(rl: Interface): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      let settled = false;

      const onClose = () => {
        if (settled) return;
        settled = true;
        reject(
          new NoInputError(
            "No input available: stdin closed before the question was answered. " +
              "Pass the value as a flag or an argument to run without prompts.",
          ),
        );
      };

      rl.once("close", onClose);
      rl.question("> ").then(
        (answer) => {
          if (settled) return;
          settled = true;
          rl.off("close", onClose);
          resolve(answer);
        },
        (error) => {
          if (settled) return;
          settled = true;
          rl.off("close", onClose);
          reject(error);
        },
      );
    });
  }
}
