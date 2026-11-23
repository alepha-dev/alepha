import { $inject, createMiddleware, type Middleware } from "alepha";
import { DateTimeProvider } from "alepha/datetime";

import { AiBudgetExceededError } from "../errors/AiBudgetExceededError.ts";
import { AiConversationService } from "./AiConversationService.ts";
import { AiSettings } from "./AiSettings.ts";

/**
 * The per-user token budget (`api.ai` parameter), checked before a turn.
 *
 * Not `$rateLimit`: a limiter counts hits and saturates at `limit + 1`, so it
 * cannot count tokens. The tokens are on the assistant message rows, and the
 * check sums them over the window. A turn is handed what is left as its
 * `tokenBudget` and wraps up before crossing it, so it overshoots by one
 * model call at most.
 */
export class AiBudgetService {
  protected readonly settings = $inject(AiSettings);
  protected readonly conversations = $inject(AiConversationService);
  protected readonly dateTime = $inject(DateTimeProvider);

  /**
   * Throws when `userId` has no budget left.
   *
   * @throws AiBudgetExceededError, a 429.
   */
  public async assertAvailable(userId: string): Promise<void> {
    const usage = await this.usage(userId);
    if (usage && usage.used >= usage.limit) {
      throw new AiBudgetExceededError(usage);
    }
  }

  /**
   * The tokens `userId` may still spend in the window, `undefined` with no
   * budget. A turn takes it as its `tokenBudget`, so it wraps up with an
   * answer before crossing the budget instead of dying past it.
   */
  public async remaining(userId: string): Promise<number | undefined> {
    const usage = await this.usage(userId);
    return usage ? Math.max(0, usage.limit - usage.used) : undefined;
  }

  protected async usage(
    userId: string,
  ): Promise<{ used: number; limit: number } | undefined> {
    const { budgetTokens, budgetWindowHours } = this.settings.current;
    if (!budgetTokens) {
      return undefined;
    }
    const since = this.dateTime
      .now()
      .subtract(budgetWindowHours, "hour")
      .toISOString();
    const used = await this.conversations.tokensSince(userId, since);
    return { used, limit: budgetTokens };
  }

  /**
   * The check as a `use` middleware, after `$secure()`: a refusal is the
   * request's 429, before any stream opens.
   */
  public middleware(): Middleware {
    return createMiddleware({
      name: "aiBudget",
      handler: ({ next }) => {
        return async (...args: any[]) => {
          const user = args[0]?.user as { id: string } | undefined;
          if (user) {
            await this.assertAvailable(user.id);
          }
          return next(...args);
        };
      },
    });
  }
}
