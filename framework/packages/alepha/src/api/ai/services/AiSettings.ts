import { createMiddleware, type Middleware, z } from "alepha";
import { $parameter } from "alepha/api/parameters";

/**
 * Runtime-editable settings of the assistant, the `api.ai` parameter: an
 * operator changes them without a redeploy, the model included.
 *
 * Its own service, as `NotificationSettings` is, because the budget guard,
 * the turn limiter and the retention job all read it.
 *
 * Read it with {@link AiSettings.load}. On serverless runtimes nothing loads
 * parameters at start, so {@link AiSettings.current} alone is the compiled
 * default in an isolate that never loaded it, whatever an operator saved.
 */
export class AiSettings {
  public readonly parameter = $parameter({
    name: "api.ai",
    description: "AI assistant model, budget, rate and retention settings.",
    schema: z.object({
      model: z
        .text({ maxLength: 200 })
        .optional()
        .describe(
          "The model a turn runs on, ahead of the assistant's own model option and of AI_MODEL; a turn the server names a model for (a persona's) keeps it. Unset keeps the assistant's or AI_MODEL. It overrides a default model, it does not replace one: the provider still needs AI_MODEL or a model option to start.",
        ),
      budgetTokens: z
        .integer()
        .min(1)
        .optional()
        .describe(
          "Tokens (input plus output) one user may spend per window. Unset means no budget. Checked before each turn, so a turn can overshoot by its own size.",
        ),
      budgetWindowHours: z
        .integer()
        .min(1)
        .describe(
          "The budget window, in hours, ending now: a sliding window rather than a calendar day.",
        ),
      turnsPerMinute: z
        .integer()
        .min(1)
        .describe("Turns (chat or resume) one user may start per minute."),
      retentionDays: z
        .integer()
        .min(1)
        .optional()
        .describe(
          "Days to keep a conversation after its last activity. Unset means keep. Page data and tool results live in the messages, so this is a privacy setting too. The daily purge reads it at every tick.",
        ),
    }),
    default: {
      budgetWindowHours: 24,
      turnsPerMinute: 20,
    },
  });

  /**
   * The value as this instance last loaded it, or the compiled default when
   * it never did. Synchronous, for a reader that cannot await, such as a
   * rate limiter's `limit`: something on the same path must call
   * {@link AiSettings.load} first.
   */
  public get current() {
    return this.parameter.cachedCurrentContent;
  }

  /**
   * The value an operator saved: loaded from the database on first use, and
   * revalidated on serverless runtimes, where another isolate may have
   * changed it.
   */
  public load() {
    return this.parameter.get();
  }

  /**
   * {@link AiSettings.load} as a `use` middleware, for a chain whose later
   * middlewares read {@link AiSettings.current}.
   */
  public middleware(): Middleware {
    return createMiddleware({
      name: "aiSettings",
      handler: ({ next }) => {
        return async (...args: any[]) => {
          await this.load();
          return next(...args);
        };
      },
    });
  }
}
