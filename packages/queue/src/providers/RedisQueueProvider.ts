import { $inject, t } from "@alepha/core";
import { RedisProvider } from "@alepha/redis";
import type { QueueProvider } from "./QueueProvider.ts";

const envSchema = t.object({
	REDIS_QUEUE_PREFIX: t.string({
		default: "queue",
	}),
});

export class RedisQueueProvider implements QueueProvider {
	protected readonly env = $inject(envSchema);
	protected readonly redisProvider = $inject(RedisProvider);

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
