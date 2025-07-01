import { $inject, $logger, Alepha } from "@alepha/core";
import { type DateTime, DateTimeProvider } from "@alepha/datetime";
import { type Cron, parseCronExpression } from "cron-schedule";

export interface CronJob {
	handler: (context: { now: DateTime }) => Promise<void>;
	cron: Cron;
	loop: boolean;
	running?: boolean;
	onError?: (error: Error) => void;
	abort: AbortController;
}

export class CronProvider {
	protected readonly dt = $inject(DateTimeProvider);
	protected readonly alepha = $inject(Alepha);
	protected readonly log = $logger();

	public start(cron: CronJob): void {
		if (!cron.running) {
			cron.running = true;
			this.log.trace("Starting cron task");
			this.run(cron);
		}
	}

	public stop(cron: CronJob): void {
		if (cron.running) {
			cron.running = false;
			cron.abort.abort();
			this.log.trace("Cron task stopped");
		}
	}

	public create(
		expression: string,
		handler: (context: { now: DateTime }) => Promise<void>,
	): CronJob {
		return {
			cron: parseCronExpression(expression),
			handler,
			loop: true,
			abort: new AbortController(),
		};
	}

	public run(task: CronJob, now = this.dt.now()): void {
		if (!task.running) {
			return;
		}

		const [next] = task.cron.getNextDates(1, now.toDate());
		if (!next) {
			return;
		}

		const duration = next.getTime() - now.toDate().getTime();

		task.abort = new AbortController();

		this.dt
			.wait(duration, {
				now: now.valueOf(),
				signal: task.abort.signal,
			})
			.then(() => {
				if (!task.running) {
					this.log.trace("Cron task stopped before execution");
					return;
				}

				this.log.trace("Running cron task");

				task.handler({ now: this.dt.of(next) }).catch((err) => {
					if (task.onError) {
						task.onError(err);
					} else {
						this.log.error("Error in cron task:", err);
					}
				});

				if (task.loop) {
					this.run(task, this.dt.of(next));
				}
			})
			.catch((err) => {
				this.log.warn("Issue during cron waiting timer", err as Error);
			});
	}
}
