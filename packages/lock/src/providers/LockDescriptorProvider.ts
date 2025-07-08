import {
	$hook,
	$inject,
	$logger,
	Alepha,
	type AsyncFn,
	type HookDescriptor,
	KIND,
	type Logger,
	OPTIONS,
	type Static,
	type TObject,
	type TString,
	t,
} from "@alepha/core";
import {
	type DateTime,
	DateTimeProvider,
	type DurationLike,
} from "@alepha/datetime";
import { $topic, type TopicDescriptor, TopicTimeoutError } from "@alepha/topic";
import type {
	LockDescriptor,
	LockDescriptorOptions,
} from "../descriptors/$lock.ts";
import { $lock } from "../descriptors/$lock.ts";
import { LockProvider } from "./LockProvider.ts";
import { LockTopicProvider } from "./LockTopicProvider.ts";

const envSchema: TObject<{
	LOCK_PREFIX_KEY: TString;
}> = t.object({
	LOCK_PREFIX_KEY: t.string({ default: "lock" }),
});

declare module "@alepha/core" {
	interface Env extends Partial<Static<typeof envSchema>> {}
}

export class LockDescriptorProvider {
	protected readonly alepha: Alepha = $inject(Alepha);
	protected readonly dateTimeProvider: DateTimeProvider =
		$inject(DateTimeProvider);
	protected readonly lockProvider: LockProvider = $inject(LockProvider);
	protected readonly lockTopicProvider: LockTopicProvider =
		$inject(LockTopicProvider);
	protected readonly log: Logger = $logger();
	protected readonly env: Static<typeof envSchema> = $inject(envSchema);
	protected readonly id: string = Math.random().toString(36).slice(2, 10);
	protected readonly locks: Map<string, LockDescriptorValue> = new Map<
		string,
		LockDescriptorValue
	>();

	protected readonly configure: HookDescriptor<"configure"> = $hook({
		on: "configure",
		handler: (alepha: Alepha) => {
			const descriptors = alepha.getDescriptorValues($lock);
			for (const { instance, key, value } of descriptors) {
				const { [OPTIONS]: options } = value;

				const lockKey = `${instance.constructor.name}.${key}`;
				this.locks.set(lockKey, {
					options,
					key: (...args: any[]) => {
						if (options.key) {
							if (typeof options.key === "string") {
								return options.key;
							}

							return options.key(...args);
						}

						return `${instance.constructor.name}:${key}`;
					},
					maxDuration: options.maxDuration ?? 1000 * 10,
				});

				const $: LockDescriptor<any> = (...args) =>
					this.run(this.locks.get(lockKey)!, ...args);

				$[KIND] = value[KIND];
				$[OPTIONS] = value[OPTIONS];

				instance[key] = $;
			}
		},
	});

	protected readonly topicLockEnd: TopicDescriptor<{
		payload: TObject<{
			name: TString;
		}>;
	}> = $topic({
		provider: () => this.lockTopicProvider,
		schema: {
			payload: t.object({
				name: t.string(),
			}),
		},
	});

	protected prefixKey(key: string) {
		return `${this.env.LOCK_PREFIX_KEY}:${key}`;
	}

	/**
	 * Run the lock handler.
	 *
	 * @param value
	 * @param args
	 */
	protected async run(
		value: LockDescriptorValue,
		...args: any[]
	): Promise<void> {
		const keyNoPrefix = value.key(...args);
		const key = this.prefixKey(keyNoPrefix);
		const handler = value.options.handler;

		const lock = await this.lock(key, value);

		if (lock.endedAt) {
			return;
		}

		if (lock.id !== this.id) {
			if (value.options.wait) {
				try {
					await this.wait(key, value.maxDuration);
				} catch (error) {
					if (error instanceof TopicTimeoutError) {
						this.log.warn(
							`Lock timeout for ${keyNoPrefix} has been reached. Retry...`,
						);
						await this.run(value, ...args);
					} else {
						throw error;
					}
				}
			}

			return;
		}

		this.log.debug(`Lock '${keyNoPrefix}' ...`);

		try {
			await handler(...args);
		} finally {
			await this.topicLockEnd.publish({
				name: key,
			});

			const gracePeriod = value.options.gracePeriod
				? value.options.gracePeriod(...args)
				: undefined;

			if (gracePeriod) {
				await this.lockProvider.set(
					key,
					`${this.id},${lock.createdAt.toISOString()},${this.dateTimeProvider.nowISOString()}`,
					false,
					this.dateTimeProvider.duration(gracePeriod).as("milliseconds"),
				);
			} else {
				await this.lockProvider.del(key);
			}

			this.log.debug(`Lock '${keyNoPrefix}' OK`);
		}
	}

	protected async wait(key: string, maxDuration: DurationLike): Promise<void> {
		this.log.debug(`Wait for lock '${key}' ...`);

		await this.topicLockEnd.wait({
			filter: (message) => message.payload.name === key,
			timeout: maxDuration,
		});

		this.log.debug(`Wait for lock '${key}' OK`);
	}

	/**
	 * Lock the key.
	 *
	 * @param key - The key to lock.
	 * @param item - The lock descriptor value.
	 */
	protected async lock(
		key: string,
		item: LockDescriptorValue,
	): Promise<LockObject> {
		const value = await this.lockProvider.set(
			key,
			`${this.id},${this.dateTimeProvider.nowISOString()}`,
			true,
			this.dateTimeProvider.duration(item.maxDuration).as("milliseconds"),
		);

		return this.parse(value);
	}

	protected parse(value: string): LockObject {
		const [id, createdAtStr, endedAtStr] = value.split(",");
		const createdAt = this.dateTimeProvider.of(createdAtStr);
		const endedAt = endedAtStr
			? this.dateTimeProvider.of(endedAtStr)
			: undefined;

		return {
			id,
			createdAt,
			endedAt,
		};
	}
}

export interface LockDescriptorValue {
	options: LockDescriptorOptions<AsyncFn>;
	key: (...args: any[]) => string;
	maxDuration: DurationLike;
}

export interface LockObject {
	id: string;
	createdAt: DateTime;
	endedAt?: DateTime;
	response?: string;
}
