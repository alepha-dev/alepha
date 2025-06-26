import type { Static } from "@alepha/core";
import { $hook, $inject, $logger, Alepha, t } from "@alepha/core";
import { createClient, type SetOptions } from "@redis/client";

const envSchema = t.object({
	REDIS_PORT: t.uint({
		default: "6379",
	}),
	REDIS_HOST: t.string({
		default: "localhost",
	}),
	REDIS_PASSWORD: t.optional(t.string()),
});

declare module "@alepha/core" {
	interface Env extends Partial<Static<typeof envSchema>> {}
}

export type RedisClient = ReturnType<typeof createClient>;
export type RedisClientOptions = Parameters<typeof createClient>[0];
export type RedisSetOptions = SetOptions;

export class RedisProvider {
	protected readonly log = $logger();
	protected readonly alepha = $inject(Alepha);
	protected readonly env = $inject(envSchema);
	protected readonly client = this.createClient();

	public get publisher(): RedisClient {
		if (!this.client.isReady) {
			throw new Error("Redis client is not ready");
		}

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

	/**
	 * Connect to the Redis server.
	 */
	public async connect(): Promise<void> {
		this.log.debug("Connecting...");
		await this.client.connect();
		this.log.info("Connection OK");
	}

	/**
	 * Close the connection to the Redis server.
	 */
	public async close(): Promise<void> {
		await this.client.close();
		this.log.info("Connection closed");
	}

	public duplicate(options?: Partial<RedisClientOptions>): RedisClient {
		return this.client.duplicate(options);
	}

	/**
	 * Redis subscriber client factory method.
	 */
	protected createClient(): RedisClient {
		const url = new URL("redis://127.0.0.1:6379");

		if (this.env.REDIS_PASSWORD) {
			url.password = this.env.REDIS_PASSWORD;
		}

		if (this.env.REDIS_HOST) {
			url.hostname = this.env.REDIS_HOST;
		}

		if (this.env.REDIS_PORT) {
			url.port = String(this.env.REDIS_PORT);
		}

		const client = createClient({
			url: url.toString(),
		});

		client.on("error", (error) => {
			if (this.alepha.isStarted()) {
				this.log.error(error);
			}
		});

		return client as RedisClient;
	}
}
