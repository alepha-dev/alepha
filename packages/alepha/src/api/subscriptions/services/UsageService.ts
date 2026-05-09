import { $inject } from "alepha";
import { CacheProvider } from "alepha/cache";
import { DateTimeProvider } from "alepha/datetime";
import { SubscriptionService } from "./SubscriptionService.ts";

// -----------------------------------------------------------------------------------------------------------------

/**
 * The result of a usage check or increment operation.
 */
export interface UsageResult {
  /**
   * Whether the operation is allowed given the current usage and limit.
   */
  allowed: boolean;

  /**
   * Current usage count for the period.
   */
  current: number;

  /**
   * The plan limit for the resource. -1 means unlimited.
   */
  limit: number;

  /**
   * Remaining capacity. -1 means unlimited.
   */
  remaining: number;
}

// -----------------------------------------------------------------------------------------------------------------

/**
 * Tracks and enforces per-organization resource usage limits.
 *
 * Usage counters are keyed by `organizationId:resource:YYYY-MM` and stored in the cache.
 * Limits are resolved from the organization's current subscription plan.
 */
export class UsageService {
  protected readonly cache = $inject(CacheProvider);
  protected readonly dateTime = $inject(DateTimeProvider);
  protected readonly subscriptionService = $inject(SubscriptionService);

  /**
   * Increment a resource counter for the current period and return the usage result.
   *
   * @param organizationId The organization to track usage for.
   * @param resource The resource identifier (e.g., "api_calls", "seats").
   * @param amount Amount to increment by (default: 1).
   */
  public async increment(
    organizationId: string,
    resource: string,
    amount = 1,
  ): Promise<UsageResult> {
    const limit = await this.subscriptionService.limit(
      organizationId,
      resource,
    );
    const key = this.buildKey(organizationId, resource);
    const current = await this.cache.incr("subscriptions:usage", key, amount);
    const allowed = limit === -1 || current <= limit;
    return {
      allowed,
      current,
      limit,
      remaining: limit === -1 ? -1 : Math.max(0, limit - current),
    };
  }

  /**
   * Get the current usage for a resource without incrementing.
   *
   * @param organizationId The organization to query usage for.
   * @param resource The resource identifier.
   */
  public async getUsage(
    organizationId: string,
    resource: string,
  ): Promise<UsageResult> {
    const limit = await this.subscriptionService.limit(
      organizationId,
      resource,
    );
    const key = this.buildKey(organizationId, resource);
    const current = await this.cache.incr("subscriptions:usage", key, 0);
    return {
      allowed: limit === -1 || current <= limit,
      current,
      limit,
      remaining: limit === -1 ? -1 : Math.max(0, limit - current),
    };
  }

  /**
   * Reset all usage counters for an organization.
   *
   * Used at the start of a new billing period.
   *
   * @param organizationId The organization whose counters to reset.
   */
  public async resetForPeriod(organizationId: string): Promise<void> {
    const pattern = this.buildKey(organizationId, "*");
    await this.cache.invalidateKeys("subscriptions:usage", [pattern]);
  }

  /**
   * Build the cache key for a usage counter.
   *
   * Format: `organizationId:resource:YYYY-MM`
   */
  protected buildKey(organizationId: string, resource: string): string {
    const period = this.dateTime.now().format("YYYY-MM");
    return `${organizationId}:${resource}:${period}`;
  }
}
