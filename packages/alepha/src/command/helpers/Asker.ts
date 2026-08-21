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

export interface AskConfirmOptions {
  /**
   * Taken when the answer is empty. Without one, an empty answer re-asks
   * rather than guessing.
   */
  default?: boolean;
}

export interface AskChoice {
  value: string;

  /**
   * Printed in place of the value. Defaults to the value.
   */
  label?: string;
}

export type AskChoices = ReadonlyArray<string | AskChoice>;

/**
 * The value type behind one entry of a choice list.
 *
 * Distributive on purpose: a list may mix bare strings and labelled objects,
 * and both shapes have to collapse to the same string union.
 */
export type AskChoiceValueOf<I> = I extends string
  ? I
  : I extends AskChoice
    ? I["value"]
    : never;

/**
 * The union of every value a choice list can yield.
 *
 * This is what makes `choice("...", ["red", "blue"])` return `"red" | "blue"`
 * rather than `string`, so a caller can pass the result straight into a typed
 * flag without a cast.
 */
export type AskChoiceValue<C extends AskChoices> = AskChoiceValueOf<C[number]>;

export interface AskChoiceOptions<C extends AskChoices> {
  /**
   * Taken when the answer is empty, and marked "(default)" in the list.
   *
   * A value, never an index: an index quietly means something else the moment
   * somebody reorders the list.
   */
  default?: AskChoiceValue<C>;
}

export interface AskMultiChoiceOptions<C extends AskChoices> {
  /**
   * Taken when the answer is empty, and marked "(default)" in the list.
   */
  default?: Array<AskChoiceValue<C>>;
}

export interface AskMethods {
  /**
   * Ask for a free-form value, decoded through a schema.
   */
  prompt<T extends ZType = ZodString>(
    question: string,
    options?: AskOptions<T>,
  ): Promise<Infer<T>>;

  /**
   * Ask a yes/no question.
   */
  confirm(question: string, options?: AskConfirmOptions): Promise<boolean>;

  /**
   * Ask for one entry of a numbered list.
   */
  choice<const C extends AskChoices>(
    question: string,
    choices: C,
    options?: AskChoiceOptions<C>,
  ): Promise<AskChoiceValue<C>>;

  /**
   * Ask for any number of entries of a numbered list.
   */
  multiChoice<const C extends AskChoices>(
    question: string,
    choices: C,
    options?: AskMultiChoiceOptions<C>,
  ): Promise<Array<AskChoiceValue<C>>>;

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

      confirm: (question: string, options: AskConfirmOptions = {}) =>
        this.confirmValue(question, options),

      choice: <const C extends AskChoices>(
        question: string,
        choices: C,
        options: AskChoiceOptions<C> = {},
      ) =>
        this.chooseOne(
          question,
          choices,
          options.default as string | undefined,
        ) as Promise<AskChoiceValue<C>>,

      multiChoice: <const C extends AskChoices>(
        question: string,
        choices: C,
        options: AskMultiChoiceOptions<C> = {},
      ) =>
        this.chooseMany(
          question,
          choices,
          options.default as string[] | undefined,
        ) as Promise<Array<AskChoiceValue<C>>>,

      intro: (title: string) => this.printIntro(title),
      outro: (message: string) => this.printOutro(message),
    };
  }

  /**
   * Ask one question until the answer parses, then return it.
   *
   * `render` prints the question (and whatever goes with it) on every attempt,
   * so a rejected answer is followed by the question again rather than a bare
   * `>`. `parse` is responsible for having printed the reason before it
   * returns.
   *
   * `parse`'s return value distinguishes "here is a value" from "not valid,
   * ask again" without overloading `undefined`: returning `undefined` itself
   * means retry, and returning `{ value }` accepts the answer — including
   * `{ value: undefined }`, which is how a legitimate empty answer (an
   * optional field left blank) is accepted rather than mistaken for a retry.
   *
   * Every question type in this class goes through here, which is what makes
   * the EOF handling below cost one implementation instead of four.
   */
  protected async loop<V>(
    render: () => void,
    parse: (answer: string) => { value: V } | undefined,
  ): Promise<V> {
    const rl = this.getPromptInterface();
    try {
      for (;;) {
        render();
        // The blank lines live here rather than in each `print*` helper, so
        // every question type is framed the same way: what was asked, then
        // air, then the `> ` readline writes, then air again before whatever
        // the command says next. Packed tight, a wizard reads as one wall of
        // text and the answers are indistinguishable from the questions.
        this.output.print();
        const answer = await this.readLine(rl);
        this.output.print();
        const result = parse(answer.trim());
        if (result !== undefined) {
          return result.value;
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
          return { value };
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

  /**
   * Ask a yes/no question.
   *
   * The bracket hint tells the user which way an empty answer goes: `[Y/n]`,
   * `[y/N]`, or `[y/n]` when there is no default and Enter alone is not an
   * answer at all.
   */
  protected confirmValue(
    question: string,
    options: AskConfirmOptions,
  ): Promise<boolean> {
    const hint =
      options.default === true
        ? "[Y/n]"
        : options.default === false
          ? "[y/N]"
          : "[y/n]";

    return this.loop<boolean>(
      () => this.printQuestion(`${question} ${hint}`),
      (answer) => {
        if (!answer) {
          if (options.default === undefined) {
            this.printError("Invalid answer, expected 'y' or 'n'");
            return undefined;
          }
          return { value: options.default };
        }

        const normalized = answer.toLowerCase();
        if (normalized === "y" || normalized === "yes") return { value: true };
        if (normalized === "n" || normalized === "no") return { value: false };

        this.printError("Invalid answer, expected 'y' or 'n'");
        return undefined;
      },
    );
  }

  /**
   * Reject an empty choice list, and reject a default that is not in it.
   *
   * Both are developer mistakes rather than bad user input, so both fail
   * loudly here instead of reaching the loop. An empty list makes `chooseOne`
   * unanswerable: every branch of `parse` returns `undefined`, so the user
   * sees the range error repeat forever with no input that can satisfy it.
   * A default outside the list is not caught by the generic parameter when
   * `choices` is a widened `string[]` rather than a literal tuple, so it
   * would otherwise hand back an answer nobody was ever offered. Called
   * before the loop starts, so it fails before any question is printed.
   */
  protected assertDefaults(items: AskChoice[], defaults: string[]): void {
    if (items.length === 0) {
      throw new AlephaError(
        "Cannot ask a choice with an empty list of choices",
      );
    }

    const values = items.map((item) => item.value);
    for (const value of defaults) {
      if (!values.includes(value)) {
        throw new AlephaError(
          `Invalid default "${value}", expected one of: ${values.join(", ")}`,
        );
      }
    }
  }

  /**
   * Ask for one entry of a numbered list.
   */
  protected async chooseOne(
    question: string,
    choices: AskChoices,
    defaultValue?: string,
  ): Promise<string> {
    const items = this.normalizeChoices(choices);
    this.assertDefaults(
      items,
      defaultValue === undefined ? [] : [defaultValue],
    );

    return this.loop<string>(
      () =>
        this.printChoices(
          question,
          items,
          defaultValue === undefined ? [] : [defaultValue],
        ),
      (answer) => {
        if (!answer) {
          if (defaultValue === undefined) {
            this.printError(this.rangeError(items.length));
            return undefined;
          }
          return { value: defaultValue };
        }

        // Number("1 2") is NaN, so a multi-number answer is rejected here
        // rather than quietly taking the first one. The digit check runs
        // first so formats Number() would otherwise accept — hex ("0x2"),
        // scientific notation ("2e0"), a leading "+" — are rejected too.
        if (!/^\d+$/.test(answer)) {
          this.printError(this.rangeError(items.length));
          return undefined;
        }

        const position = Number(answer);
        if (position < 1 || position > items.length) {
          this.printError(this.rangeError(items.length));
          return undefined;
        }

        return { value: items[position - 1].value };
      },
    );
  }

  /**
   * Ask for any number of entries of a numbered list.
   */
  protected async chooseMany(
    question: string,
    choices: AskChoices,
    defaultValues?: string[],
  ): Promise<string[]> {
    const items = this.normalizeChoices(choices);
    this.assertDefaults(items, defaultValues ?? []);

    return this.loop<string[]>(
      () => {
        this.printChoices(question, items, defaultValues ?? []);
        this.printHint(
          "Enter numbers separated by spaces, commas, semicolons, or dashes (a dash separates, not a range).",
        );
      },
      (answer) => {
        // Selecting nothing is a legitimate answer here, so an empty line is
        // not an error the way it is for `choice`.
        if (!answer) {
          return { value: defaultValues ?? [] };
        }

        const positions = this.parseSelection(answer, items.length);
        if (!positions) {
          this.printError(this.rangeError(items.length));
          return undefined;
        }

        return {
          value: positions.map((position) => items[position - 1].value),
        };
      },
    );
  }

  /**
   * Parse a list of 1-based positions, or `undefined` if any part of it is
   * unusable.
   *
   * `-` is a **separator, not a range**: "1-4" means items 1 and 4, never 1
   * through 4. Ranges would be ambiguous against the other separators and are
   * deliberately not supported, so every one of these means the same thing:
   *
   * ```
   * 1 4 10
   * 1-4-10
   * 1,4,10
   * 1,-     4,,,,----       10
   * ```
   *
   * One bad token invalidates the whole answer rather than being skipped: a
   * silently dropped selection is worse than being asked again.
   */
  protected parseSelection(input: string, max: number): number[] | undefined {
    const tokens = input.split(/[\s,;-]+/).filter(Boolean);
    if (tokens.length === 0) {
      return undefined;
    }

    const positions: number[] = [];
    for (const token of tokens) {
      // Plain digits only. `Number()` alone would accept "0x2", "2e0" and
      // "+2", none of which anybody types to pick a menu item. Match the guard
      // `chooseOne` already uses.
      if (!/^\d+$/.test(token)) {
        return undefined;
      }
      const position = Number(token);
      if (position < 1 || position > max) {
        return undefined;
      }
      if (!positions.includes(position)) {
        positions.push(position);
      }
    }

    return positions;
  }

  /**
   * Widen every entry to `{ value, label }` so the renderer has one shape to
   * deal with.
   */
  protected normalizeChoices(choices: AskChoices): AskChoice[] {
    return choices.map((choice) =>
      typeof choice === "string"
        ? { value: choice, label: choice }
        : { value: choice.value, label: choice.label ?? choice.value },
    );
  }

  /**
   * Print the question and its numbered list, blank line between the two.
   *
   * Nothing after the list: {@link loop} adds the blank that separates it from
   * the `> ` prompt, and `multiChoice` still has its hint to print in between.
   */
  protected printChoices(
    question: string,
    items: AskChoice[],
    defaults: string[],
  ): void {
    this.printQuestion(question);
    this.output.print();

    items.forEach((item, index) => {
      const marker = this.color.set("CYAN", `${index + 1}.`);
      const suffix = defaults.includes(item.value)
        ? ` ${this.color.set("GREY_DARK", "(default)")}`
        : "";
      this.output.print(`${marker} ${item.label}${suffix}`);
    });
  }

  protected rangeError(max: number): string {
    return `Invalid answer, expected a number between 1 and ${max}`;
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
    // A rejected answer is followed by the whole question again, so the reason
    // needs air under it or it reads as part of the question it precedes.
    this.output.print();
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
