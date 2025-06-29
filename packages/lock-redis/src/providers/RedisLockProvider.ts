import { $inject, $logger } from "@alepha/core";
import type { LockProvider } from "@alepha/lock";
import { RedisProvider, type RedisSetOptions } from "@alepha/redis";

export class RedisLockProvider implements LockProvider {
	protected readonly log = $logger();
	protected readonly redisProvider = $inject(RedisProvider);

	public async set(
		key: string,
		value: string,
		nx?: boolean,
		px?: number,
	): Promise<string> {
		const options: RedisSetOptions = {
			GET: true, // all the secrets of $lock is based on this
		};

		if (px) {
			options.expiration = {
				type: "PX",
				value: px,
			};
		}

		if (nx) {
			options.condition = "NX";
		}

		const resp = await this.redisProvider.set(key, value, options);
		if (resp === null) {
			this.log.debug(`Lock already exists`, { key, value });
			return value;
		}

		return resp.toString("utf-8");
	}

	public async del(...keys: string[]): Promise<void> {
		await this.redisProvider.del(keys);
	}
}
