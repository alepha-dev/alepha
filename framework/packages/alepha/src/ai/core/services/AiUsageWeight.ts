import type { AiUsage } from "../providers/AiProvider.ts";

/**
 * The tokens a model call counts for.
 */
type Weighed = {
  [K in keyof AiUsage]?: AiUsage[K] | null;
};

/**
 * What a model call's tokens weigh against a bound: a turn's `turnTokens`
 * and `tokenBudget` (`$ai`), a user's budget (`alepha/api/ai`). One rule for
 * all of them, so a turn wraps up in the unit its budget is counted in.
 *
 * A token read from the vendor's prompt cache weighs a tenth, Anthropic's
 * price for a cache read. Without it a cached tool list costs its full size
 * on every model call of a turn, and a turn of three calls is "out of
 * tokens" having spent a third of what the count says.
 */
export class AiUsageWeight {
  /**
   * What a token read from the vendor's prompt cache weighs.
   */
  public static readonly CACHE_READ = 0.1;

  /**
   * What one call's tokens weigh: input and output, a cache read at
   * {@link CACHE_READ}. Rounded up.
   */
  public static of(usage: Weighed): number {
    const input = usage.inputTokens ?? 0;
    const cached = Math.min(usage.cachedInputTokens ?? 0, input);
    return Math.ceil(
      input -
        cached * (1 - AiUsageWeight.CACHE_READ) +
        (usage.outputTokens ?? 0),
    );
  }

  /**
   * What the next call of the same turn weighs at least: it resends what
   * this one read, and reads back from the cache what this one read from it
   * or wrote to it. After a call that wrote the cache, that is a tenth of
   * what the call itself weighed.
   */
  public static next(usage: Weighed): number {
    return AiUsageWeight.of({
      ...usage,
      cachedInputTokens:
        (usage.cachedInputTokens ?? 0) + (usage.cacheWriteInputTokens ?? 0),
    });
  }
}
