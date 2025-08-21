import {
	$env,
	$hook,
	$inject,
	Alepha,
	type Static,
	type TNumber,
	type TObject,
	type TOptional,
	type TString,
	t,
} from "@alepha/core";
import { $logger } from "@alepha/logger";
import {
	createClient,
	RESP_TYPES,
	type RedisClientType,
	type SetOptions,
} from "@redis/client";

const envSchema: TObject<{
	REDIS_PORT: TNumber;
	REDIS_HOST: TString;
	REDIS_PASSWORD: TOptional<TString>;
}> = t.object({
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

export type RedisClient = RedisClientType<
	{},
	{},
	{},
	3,
	{ 36: BufferConstructor }
>;
export type RedisClientOptions = Parameters<typeof createClient>[0];
export type RedisSetOptions = SetOptions;

/**
 * Redis client provider.
 */
export class RedisProvider {
	protected readonly log = $logger();
	protected readonly alepha = $inject(Alepha);
	protected readonly env = $env(envSchema);
	protected readonly client = this.createClient();

	public get publisher(): RedisClient {
		if (!this.client.isReady) {
			throw new Error("Redis client is not ready");
		}

		return this.client;
	}

	protected readonly start = $hook({
		on: "start",
		handler: () => this.connect(),
	});

	protected readonly stop = $hook({
		on: "stop",
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
		this.log.debug("Closing connection...");
		await this.client.close();
		this.log.info("Connection closed");
	}

	public duplicate(options?: Partial<RedisClientOptions>): RedisClient {
		return this.client
			.duplicate({
				...options,
				RESP: 3,
			})
			.withTypeMapping({
				[RESP_TYPES.BLOB_STRING]: Buffer,
			});
	}

	public async get(key: string): Promise<Buffer | undefined> {
		this.log.trace(`Getting key ${key}`);
		const resp = await this.publisher.get(key);

		if (resp === null) {
			return undefined;
		}

		return Buffer.from(resp);
	}

	public async set(
		key: string,
		value: Buffer | string,
		options?: RedisSetOptions,
	): Promise<Buffer> {
		const buf = Buffer.isBuffer(value) ? value : Buffer.from(value, "utf-8");
		const resp = await this.publisher.set(key, buf, options);

		if (resp === "OK" || !resp) {
			return buf;
		}

		return Buffer.from(resp);
	}

	public async has(key: string): Promise<boolean> {
		const resp = await this.publisher.exists(key);
		return resp > 0;
	}

	public async keys(pattern: string): Promise<string[]> {
		const keys = await this.publisher.keys(pattern);
		return keys.map((key) => key.toString());
	}

	public async del(keys: string[]): Promise<void> {
		if (keys.length === 0) {
			return;
		}

		await this.publisher.del(keys);
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
			RESP: 3,
		}).withTypeMapping({
			[RESP_TYPES.BLOB_STRING]: Buffer,
		});

		client.on("error", (error) => {
			if (this.alepha.isStarted()) {
				this.log.error(error);
			}
		});

		return client;
	}
}
