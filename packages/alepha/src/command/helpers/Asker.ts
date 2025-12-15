import { stdin as input, stdout as output } from "node:process";
import { createInterface as createPromptInterface } from "node:readline/promises";
import {
  $inject,
  Alepha,
  AlephaError,
  type Static,
  type TSchema,
  type TString,
  t,
} from "alepha";
import { $logger } from "alepha/logger";

export interface AskOptions<T extends TSchema = TString> {
  /**
   * Response schema expected.
   *
   * Recommended schemas:
   * - t.text() - for free text input
   * - t.number() - for numeric input
   * - t.boolean() - for yes/no input (accepts "true", "false", "1", "0")
   * - t.enum(["option1", "option2"]) - for predefined options
   *
   * You can use schema.default to provide a default value.
   *
   * @example
   * ```ts
   * ask("What is your name?", { schema: t.text({ default: "John Doe" }) })
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
}

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
        schema: t.enum(["Y", "y", "n", "no", "yes"], { default: "Y" }),
      });
      return response.charAt(0).toLowerCase() === "y";
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
          const answer = await rl.question(`${question}\n> `);
          if (options.schema) {
            value = this.alepha.codec.decode(
              options.schema,
              answer ? answer.trim() : undefined,
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
