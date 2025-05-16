import type { ClassEntry } from "@alepha/core";
import { $inject, Alepha, t } from "@alepha/core";
import { DateTimeProvider } from "@alepha/datetime";
import {
	LockProvider,
	MemoryLockProvider,
	RedisLockProvider,
} from "@alepha/lock";
import { expect, test } from "vitest";
import { $scheduler } from "../src";

const store: Record<string, string> = {};

class SharedLockProvider extends MemoryLockProvider {
	store = store;
}

const env = t.object({
	LOCK: t.boolean(),
});

class TestSchedulerCron {
	env = $inject(env);
	tick = 0;
	t = $scheduler({
		cron: "* * * * * *",
		lock: this.env.LOCK,
		handler: async () => {
			this.tick += 1;
		},
	});
}

const createApp = <T extends object>(
	testClass: ClassEntry<T>,
	LOCK: boolean,
	provider?: "redis",
): Alepha => {
	return Alepha.create({ env: { LOCK } })
		.with({
			provide: LockProvider,
			use: provider === "redis" ? RedisLockProvider : SharedLockProvider,
		})
		.with(DateTimeProvider)
		.with(testClass);
};

const testSchedulerCron = async (lock: boolean, provider?: "redis") => {
	const apps = [
		createApp(TestSchedulerCron, lock, provider),
		createApp(TestSchedulerCron, lock, provider),
		createApp(TestSchedulerCron, lock, provider),
	];

	await Promise.all(apps.map((app) => app.start()));

	const sum = () =>
		apps.reduce((acc, app) => acc + app.get(TestSchedulerCron).tick, 0);

	if (lock) {
		await expect
			.poll(() => expect(sum()).toEqual(2), {
				timeout: 3000,
			})
			.toBeTruthy();
	} else {
		await expect
			.poll(() => expect(sum()).toEqual(2 * apps.length), {
				timeout: 3000,
			})
			.toBeTruthy();
	}

	await Promise.all(apps.map((app) => app.stop()));
};

test("$scheduler - cron", async () => {
	await testSchedulerCron(true);
});

test("$scheduler - cron no-lock", async () => {
	await testSchedulerCron(false);
});

test("$scheduler - cron (redis)", async () => {
	await testSchedulerCron(true, "redis");
});

test("$scheduler - cron no-lock (redis)", async () => {
	await testSchedulerCron(false, "redis");
});
