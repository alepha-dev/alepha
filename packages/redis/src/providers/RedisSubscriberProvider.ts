import { $hook, $inject, $logger, Alepha } from "@alepha/core";
import type { RedisClient } from "./RedisProvider.ts";
import { RedisProvider } from "./RedisProvider.ts";

export class RedisSubscriberProvider {
	protected readonly log = $logger();
	protected readonly alepha = $inject(Alepha);
	protected readonly redisProvider = $inject(RedisProvider);
	protected readonly client = this.createClient();

	public get subscriber(): RedisClient {
		return this.client;
	}

	protected readonly start = $hook({
		name: "start",
		handler: () => this.connect(),
	});

	protected readonly stop = $hook({
		name: "stop",
		handler: () => this.close(),
	});

	public async connect(): Promise<void> {
		this.log.debug("Connecting...");
		await this.subscriber.connect();
		this.log.info("Connection OK");
	}

	public close(): void {
		this.subscriber.disconnect();
	}

	/**
	 * Redis subscriber client factory method.
	 */
	protected createClient(): RedisClient {
		const client = this.redisProvider.publisher.duplicate({
			autoResubscribe: true,
		});

		client.on("error", (error) => {
			if (this.alepha.isStarted()) {
				this.log.error(error);
			}
		});

		return client;
	}
}
