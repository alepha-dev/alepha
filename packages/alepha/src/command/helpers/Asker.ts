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
  z,
} from "alepha";
import { $logger } from "alepha/logger";
import { NoInputError } from "../errors/NoInputError.ts";

export interface AskOptions<T extends ZType = ZodString> {
  /**
   * Response schema expected.
   *
   * Recommended schemas:
   * - z.text() - for free text input
   * - z.number() - for numeric input
   * - z.boolean() - for yes/no input (accepts "true", "false", "1", "0")
   * - z.enum(["option1", "option2"]) - for predefined options
   *
   * You can use schema.default to provide a default value.
   *
   * @example
   * ```ts
   * ask("What is your name?", { schema: z.text({ default: "John Doe" }) })
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

export interface AskMethod {
  <T extends ZType = ZodString>(
    question: string,
    options?: AskOptions<T>,
  ): Promise<Infer<T>>;

  permission: (question: string) => Promise<boolean>;
  intro: (title: string) => void;
  outro: (message: string) => void;
}

/**
 * Reads interactive input from the terminal using plain readline prompts.
 *
 * One straightforward code path: questions are printed through the logger
 * and answers are read with Node's `readline`. No raw-mode cursor control,
 * no ANSI framing — output stays greppable and works the same in a TTY,
 * under CI, or when piped.
 */
export class Asker {
  protected readonly log = $logger();
  public readonly ask: AskMethod;
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
    this.ask = this.createAskMethod();
  }

  /**
   * Release stdin so the process can exit.
   *
   * Holding an open readline interface keeps a `ref`'d handle on stdin, and
   * node stays alive on it forever.
   *
   * Idempotent, and safe to call before another question: the next `ask()`
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

  protected createAskMethod(): AskMethod {
    const askFn: AskMethod = async <T extends ZType = ZodString>(
      question: string,
      options: AskOptions<T> = {},
    ) => {
      return await this.prompt<T>(question, options);
    };

    askFn.permission = async (question: string) => {
      const response = await this.prompt(`${question} [Y/n]`, {
        schema: z
          .enum(["Y", "y", "N", "n", "no", "No", "NO", "yes", "Yes", "YES"])
          .default("Y"),
      });
      return response.charAt(0).toLowerCase() === "y";
    };

    askFn.intro = (title: string) => {
      this.log.info(title);
    };

    askFn.outro = (message: string) => {
      if (message) this.log.info(message);
    };

    return askFn;
  }

  protected async prompt<T extends ZType = ZodString>(
    question: string,
    options: AskOptions<T>,
  ): Promise<Infer<T>> {
    const rl = this.getPromptInterface();
    let value: any;
    try {
      do {
        try {
          this.log.info(question);
          const answer = await this.readLine(rl);
          if (options.schema) {
            // The terminal is a string-only boundary (like HTTP query/env), so
            // coerce the answer to the schema's scalar type before strict
            // decoding — otherwise `z.number()` would reject the string "41".
            const raw = answer ? answer.trim() : undefined;
            value = this.alepha.codec.decode(
              options.schema,
              raw === undefined ? undefined : coerceScalar(options.schema, raw),
            );
          } else {
            value = String(answer.trim());
          }
          if (options.validate) {
            options.validate(value);
          }
        } catch (error) {
          // An unanswerable question must not be re-asked: stdin is gone, so
          // the retry below would spin forever printing the same prompt.
          if (error instanceof NoInputError) {
            throw error;
          }
          if (error instanceof AlephaError) {
            this.log.error(`${error.message}\n`);
            value = undefined;
          } else {
            throw error;
          }
        }
      } while (value === undefined);
    } catch (error) {
      // The interface is shared for the whole session, so it is closed on
      // `stop` rather than here — except on EOF, where there is nothing left
      // to read and holding it open only delays the exit.
      if (error instanceof NoInputError) {
        this.rl?.close();
        this.rl = undefined;
      }
      throw error;
    }

    return value;
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
