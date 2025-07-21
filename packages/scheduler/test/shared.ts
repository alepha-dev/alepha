import { randomUUID } from "node:crypto";
import { Alepha, type Service } from "@alepha/core";
import { DateTimeProvider } from "@alepha/datetime";
import { LockProvider, MemoryLockProvider } from "@alepha/lock";
import { expect } from "vitest";
import { $scheduler, type SchedulerDescriptorOptions } from "../src";

const store: Record<string, string> = {};

export class SharedLockProvider extends MemoryLockProvider {
	store = store;
}

export const testSchedulerBasic = async (options: {
	scheduler: Partial<SchedulerDescriptorOptions>;
	lock?: Service<LockProvider>;
}) => {
	let count = 0;

	class TestApp {
		t = $scheduler({
			...options.scheduler,
			lock: !!options.lock,
			handler: async () => {
				count += 1;
			},
		});
	}

	const prefix = randomUUID();

	const createApp = () => {
		const alepha = Alepha.create({ env: { LOCK_PREFIX_KEY: prefix } });

		if (options.lock) {
			alepha.with({
				provide: LockProvider,
				use: options.lock,
			});
		}

		alepha.with(DateTimeProvider);
		alepha.with(TestApp);

		return alepha;
	};

	const apps = [createApp(), createApp(), createApp(), createApp()];

	expect(count).toEqual(0);

	await Promise.all(apps.map((app) => app.start()));

	expect(count).toEqual(0);

	if (options.scheduler.interval) {
		await Promise.all(
			apps.map((app) => app.get(DateTimeProvider).travel([64, "seconds"])),
		);
	} else {
		await Promise.all(
			apps.map((app) => app.get(DateTimeProvider).travel([1, "hour"])),
		);
	}

	await new Promise((r) => setTimeout(r, 100));

	if (options.lock) {
		await expect.poll(() => expect(count).toEqual(1)).toBeTruthy();
	} else {
		await expect
			.poll(() => expect(count).toEqual(1 * apps.length))
			.toBeTruthy();
	}

	await Promise.all(apps.map((app) => app.stop()));
};
