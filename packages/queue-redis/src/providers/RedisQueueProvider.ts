import { $env, $inject, type Static, t } from "@alepha/core";
import type { QueueProvider } from "@alepha/queue";
import { RedisProvider } from "@alepha/redis";

const envSchema = t.object({
	REDIS_QUEUE_PREFIX: t.string({
		default: "queue",
	}),
});

export class RedisQueueProvider implements QueueProvider {
	protected readonly env: Static<typeof envSchema> = $env(envSchema);
	protected readonly redisProvider: RedisProvider = $inject(RedisProvider);

	public prefix(queue: string): string {
		return `${this.env.REDIS_QUEUE_PREFIX}:${queue}`;
	}

	public async push(queue: string, message: string): Promise<void> {
		await this.redisProvider.publisher.LPUSH(this.prefix(queue), message);
	}

	public async pop(queue: string): Promise<string | undefined> {
		const value = await this.redisProvider.publisher.RPOP(this.prefix(queue));
		if (value == null) {
			return undefined;
		}

		return String(value);
	}
}
