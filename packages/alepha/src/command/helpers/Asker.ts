import { stdin as input, stdout as output } from "node:process";
import { createInterface as createPromptInterface } from "node:readline/promises";
import {
  $inject,
  Alepha,
  AlephaError,
  coerceScalar,
  type Static,
  type TSchema,
  type TString,
  z,
} from "alepha";
import { $logger } from "alepha/logger";

export interface AskOptions<T extends TSchema = TString> {
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
   * @default TString
   */
  schema?: T;

  /**
   * Custom validation function.
   * Throws an AlephaError in case of validation failure.
   */
  validate?: (value: Static<T>) => void;
}

export interface AskMethod {
  <T extends TSchema = TString>(
    question: string,
    options?: AskOptions<T>,
  ): Promise<Static<T>>;

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

  constructor() {
    this.ask = this.createAskMethod();
  }

  protected createAskMethod(): AskMethod {
    const askFn: AskMethod = async <T extends TSchema = TString>(
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

  protected async prompt<T extends TSchema = TString>(
    question: string,
    options: AskOptions<T>,
  ): Promise<Static<T>> {
    const rl = this.createPromptInterface();
    let value: any;
    try {
      do {
        try {
          this.log.info(question);
          const answer = await rl.question("> ");
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
          if (error instanceof AlephaError) {
            this.log.error(`${error.message}\n`);
            value = undefined;
          } else {
            throw error;
          }
        }
      } while (value === undefined);
    } finally {
      rl.close();
    }

    return value;
  }

  protected createPromptInterface() {
    return createPromptInterface({ input, output });
  }
}
