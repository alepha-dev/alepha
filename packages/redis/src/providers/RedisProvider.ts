import type { Static } from "@alepha/core";
import { $hook, $inject, $logger, Alepha, t } from "@alepha/core";
import Redis, { type RedisOptions } from "ioredis";

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

export type RedisClient = Redis;

export class RedisProvider {
	protected readonly log = $logger();
	protected readonly alepha = $inject(Alepha);
	protected readonly env = $inject(envSchema);
	protected readonly client = this.createClient();

	public get publisher(): RedisClient {
		if (this.client.status !== "ready") {
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
	public close(): Promise<void> {
		return new Promise<void>((resolve, reject) => {
			this.client.quit((error) => {
				if (error) {
					return reject(error);
				}

				this.log.info("Connection closed");
				resolve();
			});
		});
	}

	public duplicate(options?: Partial<RedisOptions>): RedisClient {
		return this.client.duplicate(options);
	}

	/**
	 * Redis subscriber client factory method.
	 */
	protected createClient(): RedisClient {
		const client = new Redis({
			port: this.env.REDIS_PORT,
			host: this.env.REDIS_HOST,
			password: this.env.REDIS_PASSWORD,
			lazyConnect: true,
		});

		client.on("error", (error) => {
			if (this.alepha.isStarted()) {
				this.log.error(error);
			}
		});

		return client;
	}
}
