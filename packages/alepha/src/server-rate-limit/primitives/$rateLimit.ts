import { $inject, createPrimitive, KIND, Primitive } from "alepha";
import type { ServerRequest } from "alepha/server";
import type { RateLimitOptions } from "../index.ts";
import {
  type RateLimitResult,
  ServerRateLimitProvider,
} from "../providers/ServerRateLimitProvider.ts";

/**
 * Declares rate limiting for server routes or custom usage.
 * This primitive provides methods to check rate limits and configure behavior
 * within the server request/response cycle.
 *
 * @example
 * ```ts
 * class ApiService {
 *   // Apply rate limiting to specific paths
 *   apiRateLimit = $rateLimit({
 *     paths: ["/api/*"],
 *     max: 100,
 *     windowMs: 15 * 60 * 1000, // 15 minutes
 *   });
 *
 *   // Or use check() method for manual rate limiting
 *   customAction = $action({
 *     handler: async (req) => {
 *       const result = await this.apiRateLimit.check(req);
 *       if (!result.allowed) throw new Error("Rate limited");
 *       return "ok";
 *     },
 *   });
 * }
 * ```
 */
export const $rateLimit = (
  options: RateLimitPrimitiveOptions = {},
): AbstractRateLimitPrimitive => {
  return createPrimitive(RateLimitPrimitive, options);
};

// ---------------------------------------------------------------------------------------------------------------------

export interface RateLimitPrimitiveOptions extends RateLimitOptions {
  /** Name identifier for this rate limit (default: property key) */
  name?: string;
  /** Path patterns to match (supports wildcards like /api/*) */
  paths?: string[];
}

export interface AbstractRateLimitPrimitive {
  readonly name: string;
  readonly options: RateLimitPrimitiveOptions;
  check(
    request: ServerRequest,
    options?: RateLimitOptions,
  ): Promise<RateLimitResult>;
}

export class RateLimitPrimitive
  extends Primitive<RateLimitPrimitiveOptions>
  implements AbstractRateLimitPrimitive
{
  protected readonly serverRateLimitProvider = $inject(ServerRateLimitProvider);

  public get name(): string {
    return this.options.name ?? `${this.config.propertyKey}`;
  }

  protected onInit() {
    // Register this rate limit configuration with the provider
    this.serverRateLimitProvider.registerRateLimit(this.options);
  }

  /**
   * Checks rate limit for the given request using this primitive's configuration.
   */
  public async check(
    request: ServerRequest,
    options?: RateLimitOptions,
  ): Promise<RateLimitResult> {
    const mergedOptions = { ...this.options, ...options };
    return this.serverRateLimitProvider.checkLimit(request, mergedOptions);
  }
}

$rateLimit[KIND] = RateLimitPrimitive;
