import { $cache } from "@alepha/cache";
import { $env, t } from "@alepha/core";
import type { ServerRequest } from "@alepha/server";

export interface RateLimitResult {
	allowed: boolean;
	limit: number;
	remaining: number;
	resetTime: number;
	retryAfter?: number;
}

export interface RateLimitOptions {
	windowMs?: number;
	max?: number;
	keyGenerator?: (req: ServerRequest) => string;
	skipFailedRequests?: boolean;
	skipSuccessfulRequests?: boolean;
}

const envSchema = t.object({
	RATE_LIMIT_WINDOW_MS: t.number({
		default: 15 * 60 * 1000, // 15 minutes
		description: "Rate limit window in milliseconds",
	}),
	RATE_LIMIT_MAX_REQUESTS: t.number({
		default: 100,
		description: "Maximum requests per window",
	}),
});

export class ServerRateLimitProvider {
	private readonly env = $env(envSchema);

	private readonly cache = $cache<RateLimitData>({
		name: "server-rate-limit",
		ttl: [this.env.RATE_LIMIT_WINDOW_MS, "milliseconds"],
	});

	public async checkLimit(
		req: ServerRequest,
		options: RateLimitOptions = {},
	): Promise<RateLimitResult> {
		const windowMs = options.windowMs ?? this.env.RATE_LIMIT_WINDOW_MS;
		const max = options.max ?? this.env.RATE_LIMIT_MAX_REQUESTS;
		const key = this.generateKey(req, options.keyGenerator);

		const now = Date.now();
		const windowStart = now - windowMs;

		// Get current rate limit data
		const currentData = (await this.cache.get(key)) || {
			count: 0,
			windowStart: now,
			hits: [],
		};

		// Clean old hits outside the current window
		const validHits = currentData.hits.filter(
			(hit: number) => hit >= windowStart,
		);

		// Check if limit exceeded
		const allowed = validHits.length < max;
		const remaining = Math.max(0, max - validHits.length);
		const resetTime = Math.max(...validHits, windowStart) + windowMs;

		// If allowed, record this request
		if (allowed) {
			validHits.push(now);
			await this.cache.set(key, {
				count: validHits.length,
				windowStart: Math.min(currentData.windowStart, windowStart),
				hits: validHits,
			});
		}

		const result: RateLimitResult = {
			allowed,
			limit: max,
			remaining: allowed ? remaining - 1 : remaining,
			resetTime,
		};

		if (!allowed) {
			result.retryAfter = Math.ceil((resetTime - now) / 1000);
		}

		return result;
	}

	private generateKey(
		req: ServerRequest,
		keyGenerator?: (req: ServerRequest) => string,
	): string {
		if (keyGenerator) {
			return keyGenerator(req);
		}

		// Default to IP-based rate limiting
		const ip = this.getClientIP(req);
		return `ip:${ip}`;
	}

	private getClientIP(req: ServerRequest): string {
		return req.ip || "unknown";
	}
}

interface RateLimitData {
	count: number;
	windowStart: number;
	hits: number[];
}
