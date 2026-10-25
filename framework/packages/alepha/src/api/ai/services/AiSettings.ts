import { z } from "alepha";
import { $parameter } from "alepha/api/parameters";

/**
 * Runtime-editable settings of the assistant, the `api.ai` parameter: an
 * operator changes them without a redeploy.
 *
 * Its own service, as `NotificationSettings` is, because the budget guard,
 * the turn limiter and the retention job all read it.
 */
export class AiSettings {
  public readonly parameter = $parameter({
    name: "api.ai",
    description: "AI assistant budget, rate and retention settings.",
    schema: z.object({
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

  public get current() {
    return this.parameter.cachedCurrentContent;
  }
}
