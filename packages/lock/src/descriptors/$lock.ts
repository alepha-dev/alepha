import {
	$env,
	$inject,
	type AsyncFn,
	createDescriptor,
	Descriptor,
	KIND,
	type Static,
	t,
} from "@alepha/core";
import {
	type DateTime,
	DateTimeProvider,
	type DurationLike,
} from "@alepha/datetime";
import { $logger } from "@alepha/logger";
import { $topic, TopicTimeoutError } from "@alepha/topic";
import { LockProvider } from "../providers/LockProvider.ts";
import { LockTopicProvider } from "../providers/LockTopicProvider.ts";

/**
 * Lock descriptor
 *
 * Make sure that only one instance of the handler is running at a time.
 *
 * When connected to a remote store, the lock is shared across all processes.
 *
 * @param options
 */
export const $lock = <TFunc extends AsyncFn>(
	options: LockDescriptorOptions<TFunc>,
): LockDescriptor<TFunc> => {
	return createDescriptor(LockDescriptor<TFunc>, options);
};

// ---------------------------------------------------------------------------------------------------------------------

export interface LockDescriptorOptions<TFunc extends AsyncFn> {
	/**
	 * Function executed when the lock is acquired.
	 */
	handler: TFunc;

	/**
	 * If true, the handler will wait for the lock to be released.
	 *
	 * To understand:
	 *
	 * ### wait = false
	 * You have 3 servers running scheduled tasks, you want to ensure that only one of them runs the task at a time.
	 * But you don't want the other servers to wait for the lock to be released before they run the task.
	 *
	 * Problem with not waiting:
	 * If the lock is released before a new late trigger, handler will be executed multiple times.
	 * Aka, if you have 3 servers but not clock synchronized.
	 *
	 * ### wait = true
	 * You have 3 servers running a migration script on startup, migration script must be run only once.
	 * You want to wait the end of migration for each server as they all require the migration to be completed.
	 *
	 *
	 * @default false
	 */
	wait?: boolean;

	/**
	 * Create you own unique key for the lock.
	 */
	name?: string | ((...args: Parameters<TFunc>) => string);

	/**
	 * Lock timeout.
	 *
	 * @default 5 minutes
	 */
	maxDuration?: DurationLike;

	/**
	 * Additional lifetime of the lock after the handler has finished executing.
	 *
	 * This is useful to ensure that the lock is not released too early
	 *
	 * @default null
	 */
	gracePeriod?:
		| ((...args: Parameters<TFunc>) => DurationLike | undefined)
		| DurationLike;
}

// ---------------------------------------------------------------------------------------------------------------------

const envSchema = t.object({
	LOCK_PREFIX_KEY: t.string({ default: "lock" }),
});

declare module "@alepha/core" {
	interface Env extends Partial<Static<typeof envSchema>> {}
}

export class LockDescriptor<TFunc extends AsyncFn> extends Descriptor<
	LockDescriptorOptions<TFunc>
> {
	protected readonly log = $logger();
	protected readonly provider = $inject(LockProvider);
	protected readonly env = $env(envSchema);
	protected readonly dateTimeProvider = $inject(DateTimeProvider);
	protected readonly id = crypto.randomUUID();
	public readonly maxDuration = this.dateTimeProvider.duration(
		this.options.maxDuration ?? [5, "minutes"],
	);

	protected readonly topicLockEnd = $topic({
		name: `${this.env.LOCK_PREFIX_KEY}:lock-end`,
		provider: LockTopicProvider,
		schema: {
			payload: t.object({
				name: t.string(),
			}),
		},
	});

	public async run(...args: Parameters<TFunc>): Promise<void> {
		const key = this.key(...args);
		const handler = this.options.handler;

		const lock = await this.lock(key);
		if (lock.endedAt) {
			return;
		}

		if (lock.id !== this.id) {
			if (this.options.wait) {
				try {
					await this.wait(key, this.maxDuration);
				} catch (error) {
					if (error instanceof TopicTimeoutError) {
						this.log.warn(
							`Lock timeout for '${key}' has been reached. Retry...`,
						);
						await this.run(...args);
					} else {
						throw error;
					}
				}
			}

			return;
		}

		this.log.debug(`Lock '${key}' ...`);

		try {
			await handler(...args);
		} finally {
			await this.topicLockEnd.publish({
				name: key,
			});

			await this.setGracePeriod(key, lock, ...args);

			this.log.debug(`Lock '${key}' OK`);
		}
	}

	/**
	 * Set the lock for the given key.
	 */
	protected async lock(key: string): Promise<LockResult> {
		const value = await this.provider.set(
			key,
			`${this.id},${this.dateTimeProvider.nowISOString()}`,
			true,
			this.maxDuration.as("milliseconds"),
		);

		return this.parse(value);
	}

	protected async setGracePeriod(
		key: string,
		lock: LockResult,
		...args: Parameters<TFunc>
	): Promise<void> {
		const gracePeriod = this.options.gracePeriod
			? this.dateTimeProvider.isDurationLike(this.options.gracePeriod)
				? this.options.gracePeriod
				: this.options.gracePeriod(...args)
			: undefined;

		if (gracePeriod) {
			await this.provider.set(
				key,
				`${this.id},${lock.createdAt.toISOString()},${this.dateTimeProvider.nowISOString()}`,
				false,
				this.dateTimeProvider.duration(gracePeriod).as("milliseconds"),
			);
		} else {
			await this.provider.del(key);
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

	protected key(...args: Parameters<TFunc>) {
		let base = "";

		if (this.options.name) {
			if (typeof this.options.name === "string") {
				base = this.options.name;
			} else {
				base = this.options.name(...args);
			}
		} else {
			base = `${this.config.service.name}:${this.config.propertyKey}`;
		}

		return `${this.env.LOCK_PREFIX_KEY}:${base}`;
	}

	protected parse(value: string): LockResult {
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

$lock[KIND] = LockDescriptor;

export interface LockResult {
	id: string;
	createdAt: DateTime;
	endedAt?: DateTime;
	response?: string;
}
