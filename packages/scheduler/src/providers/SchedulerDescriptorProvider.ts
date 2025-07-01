import {
	$hook,
	$inject,
	$logger,
	Alepha,
	KIND,
	OPTIONS,
	type Static,
	t,
} from "@alepha/core";
import { DateTimeProvider, type Interval } from "@alepha/datetime";
import { $lock } from "@alepha/lock";
import {
	$scheduler,
	type SchedulerDescriptor,
	type SchedulerDescriptorOptions,
	type SchedulerHandlerArguments,
} from "../descriptors/$scheduler.ts";
import { type CronJob, CronProvider } from "./CronScheduler.ts";

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
	protected readonly cronProvider = $inject(CronProvider);
	protected readonly schedulers: Scheduler[] = [];

	protected readonly configure = $hook({
		name: "configure",
		handler: () => {
			this.processSchedulerDescriptors();
		},
	});

	protected readonly start = $hook({
		name: "start",
		priority: "last",
		handler: async () => {
			for (const job of this.schedulers) {
				if (job.interval) {
					await job.interval.start();
				}
				if (job.cron) {
					this.cronProvider.start(job.cron);
				}
			}
		},
	});

	protected readonly stop = $hook({
		name: "stop",
		handler: () => {
			for (const job of this.schedulers) {
				if (job.interval) {
					job.interval.clear();
				}
				if (job.cron) {
					this.cronProvider.stop(job.cron);
				}
			}
		},
	});

	protected createContextId(): string {
		const t = Date.now().toString(36);
		const r = Math.random().toString(36).slice(2, 8);

		let id = "";
		for (let i = 0; i < 10; i++) {
			id += (i % 2 === 0 ? t : r)[Math.floor(i / 2)] || "";
		}

		return (
			"c" +
			id
				.split("")
				.sort(() => 0.5 - Math.random())
				.join("")
		);
	}

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
				await scheduler.trigger({
					now: this.dateTimeProvider.now(),
				});
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
			name,
			options: options,
			trigger: this.createHandler(name, options),
		};

		if (options.cron) {
			this.log.debug(`+ Cron "${options.cron}" -> "${name}"`);
			scheduler.cron = this.cronProvider.create(
				options.cron,
				scheduler.trigger,
			);
		}

		if (options.interval) {
			this.log.debug(
				`+ Interval "${this.dateTimeProvider.duration(options.interval).humanize()}" -> "${name}"`,
			);
			scheduler.interval = this.dateTimeProvider.interval({
				duration: options.interval,
				handler: () =>
					scheduler.trigger({
						now: this.dateTimeProvider.now(),
					}),
			});
		}

		return scheduler;
	}

	protected createHandler(name: string, options: SchedulerDescriptorOptions) {
		return async (args: SchedulerHandlerArguments) => {
			if (!this.alepha.isStarted()) {
				return;
			}

			this.alepha.context.run(
				{
					context: this.createContextId(),
				},
				async () => {
					try {
						if (options.lock !== false) {
							await this.runLock({ ...options, name, args });
						} else {
							await options.handler(args);
						}
					} catch (error) {
						this.log.error("Error running scheduler:", error);
					}
				},
			);
		};
	}

	public async trigger(name: string): Promise<void> {
		const scheduler = this.schedulers.find(
			(scheduler) => scheduler.name === name,
		);

		if (scheduler) {
			await scheduler.trigger({
				now: this.dateTimeProvider.now(),
			});
		}
	}

	protected runLock = $lock({
		gracePeriod: (options) => this.getLockGracePeriod(options),
		key: (options) => this.prefix(options.name),
		handler: async (
			options: SchedulerDescriptorOptions & {
				name: string;
				args: SchedulerHandlerArguments;
			},
		) => {
			await options.handler(options.args);
		},
	});

	/**
	 * Prefix the scheduler key.
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
	trigger: (args: SchedulerHandlerArguments) => Promise<void>;
	cron?: CronJob;
	interval?: Interval;
}
