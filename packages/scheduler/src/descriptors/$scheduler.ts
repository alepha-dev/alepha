import {
	$env,
	$inject,
	Alepha,
	type Async,
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
import { $lock } from "@alepha/lock";
import { $logger } from "@alepha/logger";
import { CronProvider } from "../providers/CronProvider.ts";

/**
 * Scheduler descriptor.
 */
export const $scheduler = (
	options: SchedulerDescriptorOptions,
): SchedulerDescriptor => {
	return createDescriptor(SchedulerDescriptor, options);
};

// ---------------------------------------------------------------------------------------------------------------------

export type SchedulerDescriptorOptions = {
	/**
	 * Function to run on schedule.
	 */
	handler: (args: SchedulerHandlerArguments) => Async<void>;

	/**
	 * Name of the scheduler. Defaults to the function name.
	 */
	name?: string;

	/**
	 * Optional description of the scheduler.
	 */
	description?: string;

	/**
	 * Cron expression or interval to run the scheduler.
	 */
	cron?: string;

	/**
	 * Cron expression or interval to run the scheduler.
	 */
	interval?: DurationLike;

	/**
	 * If true, the scheduler will be locked and only one instance will run at a time.
	 * You probably need to import {@link AlephaLockRedis} for distributed locking.
	 *
	 * @default true
	 */
	lock?: boolean;
};

// ---------------------------------------------------------------------------------------------------------------------

const envSchema = t.object({
	SCHEDULER_PREFIX: t.optional(
		t.text({
			description: "Prefix store key",
		}),
	),
});

declare module "@alepha/core" {
	interface Env extends Partial<Static<typeof envSchema>> {}
}

export class SchedulerDescriptor extends Descriptor<SchedulerDescriptorOptions> {
	protected readonly log = $logger();
	protected readonly env = $env(envSchema);
	protected readonly alepha = $inject(Alepha);
	protected readonly dateTimeProvider = $inject(DateTimeProvider);
	protected readonly cronProvider = $inject(CronProvider);

	public get name(): string {
		return (
			this.options.name ??
			`${this.config.service.name}.${this.config.propertyKey}`
		);
	}

	protected onInit() {
		if (this.options.interval) {
			this.dateTimeProvider.createInterval(
				() => this.trigger(),
				this.options.interval,
			);
		}
		if (this.options.cron) {
			this.cronProvider.createCronJob(this.name, this.options.cron, () =>
				this.trigger(),
			);
		}
	}

	public async trigger(): Promise<void> {
		if (!this.alepha.isStarted()) {
			return;
		}

		const context = this.alepha.context.createContextId();

		await this.alepha.context.run(
			async () => {
				try {
					const now = this.dateTimeProvider.now();

					await this.alepha.events.emit("scheduler:begin", {
						name: this.name,
						now,
						context,
					});

					if (this.options.lock !== false) {
						await this.schedulerLock.run({ now });
					} else {
						await this.options.handler({ now });
					}

					await this.alepha.events.emit(
						"scheduler:success",
						{
							name: this.name,
							context,
						},
						{
							catch: true,
						},
					);
				} catch (error) {
					await this.alepha.events.emit(
						"scheduler:error",
						{
							name: this.name,
							error: error as Error,
							context,
						},
						{
							catch: true,
						},
					);

					this.log.error("Error running scheduler:", error);
				}

				await this.alepha.events.emit(
					"scheduler:end",
					{
						name: this.name,
						context,
					},
					{
						catch: true,
					},
				);
			},
			{
				context,
			},
		);
	}

	protected schedulerLock = $lock({
		handler: async (args: SchedulerHandlerArguments) => {
			await this.options.handler(args);
		},
	});
}

$scheduler[KIND] = SchedulerDescriptor;

// ---------------------------------------------------------------------------------------------------------------------

export interface SchedulerHandlerArguments {
	now: DateTime;
}
