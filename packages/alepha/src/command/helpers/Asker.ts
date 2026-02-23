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
import { PrettyAsker } from "./PrettyAsker.ts";

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
  intro: (title: string) => void;
  outro: (message: string) => void;
}

export class Asker {
  protected readonly log = $logger();
  public readonly ask: AskMethod;
  protected readonly alepha = $inject(Alepha);
  protected readonly pretty = $inject(PrettyAsker);

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
      if (this.pretty.enabled) {
        return this.pretty.confirm(question);
      }
      const response = await this.prompt(`${question} [Y/n]`, {
        schema: t.enum(["Y", "y", "n", "no", "yes"], { default: "Y" }),
      });
      return response.charAt(0).toLowerCase() === "y";
    };

    askFn.intro = (title: string) => {
      if (this.pretty.enabled) {
        this.pretty.intro(title);
      }
    };

    askFn.outro = (message: string) => {
      if (this.pretty.enabled) {
        this.pretty.outro(message);
      }
    };

    return askFn;
  }

  protected async prompt<T extends TSchema = TString>(
    question: string,
    options: AskOptions<T>,
  ): Promise<Static<T>> {
    if (this.pretty.enabled) {
      return this.prettyPrompt(question, options);
    }
    return this.plainPrompt(question, options);
  }

  /**
   * Pretty mode: delegate to PrettyAsker based on schema type.
   */
  protected async prettyPrompt<T extends TSchema = TString>(
    question: string,
    options: AskOptions<T>,
  ): Promise<Static<T>> {
    const schema = options.schema as any;

    // Enum schema → arrow-key select
    if (schema?.enum && Array.isArray(schema.enum)) {
      const value = await this.pretty.select(question, schema.enum);
      if (options.validate) {
        options.validate(value as Static<T>);
      }
      return value as Static<T>;
    }

    // Text/other schema → text input
    const value = await this.pretty.text(question, schema);
    if (options.validate) {
      options.validate(value as Static<T>);
    }
    return value as Static<T>;
  }

  /**
   * Plain mode: readline-based prompts (CI, Claude Code, debug).
   */
  protected async plainPrompt<T extends TSchema = TString>(
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
