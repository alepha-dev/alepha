import { OPTIONS, type Static } from "@alepha/core";
import { $hook, $inject, $logger, Alepha, KIND, t } from "@alepha/core";
import { DateTimeProvider, type Interval } from "@alepha/datetime";
import { $lock } from "@alepha/lock";
import { CronJob } from "cron";
import type {
	SchedulerDescriptor,
	SchedulerDescriptorOptions,
} from "../descriptors/$scheduler.ts";
import { $scheduler } from "../descriptors/$scheduler.ts";

const envSchema = t.object({
	SCHEDULER_PREFIX: t.optional(
		t.string({
			description: "Prefix store key",
		}),
	),
});

declare module "@alepha/core" {
	interface Env extends Partial<Static<typeof envSchema>> {}
}

export class SchedulerDescriptorProvider {
	protected readonly log = $logger();
	protected readonly env = $inject(envSchema);
	protected readonly alepha = $inject(Alepha);
	protected readonly dateTimeProvider = $inject(DateTimeProvider);
	protected readonly schedulers: Scheduler[] = [];

	protected readonly configure = $hook({
		name: "configure",
		handler: () => {
			this.processSchedulerDescriptors();
		},
	});

	protected readonly start = $hook({
		name: "start",
		handler: async () => {
			for (const job of this.schedulers) {
				if (job.cronJob) {
					job.cronJob.start();
				}
				if (job.interval) {
					await job.interval.start();
				}
			}
		},
	});

	protected readonly stop = $hook({
		name: "stop",
		handler: () => {
			for (const job of this.schedulers) {
				if (job.cronJob) {
					job.cronJob.stop();
				}
				if (job.interval) {
					job.interval.clear();
				}
			}
		},
	});

	/**
	 * Get the schedulers.
	 */
	public getSchedulers() {
		return this.schedulers;
	}

	/**
	 * Process scheduler descriptors.
	 *
	 * @protected
	 */
	protected processSchedulerDescriptors() {
		const descriptors = this.alepha.getDescriptorValues($scheduler);
		for (const { value, instance, key } of descriptors) {
			const scheduler = this.createScheduler(value[OPTIONS], instance, key);

			this.schedulers.push(scheduler);

			const $: SchedulerDescriptor = async () => {
				await scheduler.trigger();
			};

			$[KIND] = value[KIND];
			$[OPTIONS] = value[OPTIONS];

			instance[key] = $;
		}
	}

	/**
	 * Create a scheduler.
	 *
	 * @param options - The scheduler options.
	 * @param instance - The instance of the scheduler.
	 * @param key - Property key name.
	 * @protected
	 */
	protected createScheduler(
		options: SchedulerDescriptorOptions,
		instance: any,
		key: string,
	): Scheduler {
		const name = options.name ?? `${instance.constructor.name}.${key}`;
		const scheduler: Scheduler = {
			options: options,
			name,
			trigger: async () => {
				if (options.lock !== false) {
					await this.runLock({ ...options, name });
				} else {
					await this.run(options);
				}
			},
		};

		if (options.cron) {
			scheduler.cronJob = new CronJob(
				options.cron,
				scheduler.trigger,
				null,
				false,
			);
		}

		if (options.interval) {
			scheduler.interval = this.dateTimeProvider.interval({
				duration: options.interval,
				handler: scheduler.trigger,
			});
		}

		return scheduler;
	}

	public async trigger(name: string): Promise<void> {
		const scheduler = this.schedulers.find(
			(scheduler) => scheduler.name === name,
		);

		if (scheduler) {
			await scheduler.trigger();
		}
	}

	protected runLock = $lock({
		gracePeriod: (options) => this.getLockGracePeriod(options),
		key: (options) => this.prefix(options.name),
		handler: async (options: SchedulerDescriptorOptions & { name: string }) => {
			await this.run(options);
		},
	});

	protected async run(options: SchedulerDescriptorOptions) {
		if (!this.alepha.isStarted()) {
			return;
		}

		try {
			await options.handler();
		} catch (error) {
			this.log.error(error);
		}
	}

	/**
	 * Prefix the scheduler key.
	 *
	 * @param key
	 * @protected
	 */
	protected prefix(key: string) {
		const parts = ["scheduler", key];

		if (this.env.SCHEDULER_PREFIX) {
			parts.unshift(this.env.SCHEDULER_PREFIX);
		}

		return parts.join(":");
	}

	/**
	 *
	 * @param options
	 * @protected
	 */
	protected getLockGracePeriod(options: SchedulerDescriptorOptions) {
		return options.interval
			? this.dateTimeProvider.duration(options.interval).as("milliseconds") / 2
			: 500;
	}
}

export interface Scheduler {
	name: string;
	options: SchedulerDescriptorOptions;
	trigger: () => Promise<void>;
	cronJob?: CronJob;
	interval?: Interval;
}
