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

const intervalDurationMs = 250;

const env = t.object({
	LOCK: t.boolean(),
});

class TestSchedulerInterval {
	env = $inject(env);
	tick = 0;
	t = $scheduler({
		interval: { milliseconds: intervalDurationMs },
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

const testSchedulerInterval = async (lock: boolean, provider?: "redis") => {
	const apps = [
		createApp(TestSchedulerInterval, lock, provider),
		createApp(TestSchedulerInterval, lock, provider),
		createApp(TestSchedulerInterval, lock, provider),
		createApp(TestSchedulerInterval, lock, provider),
	];

	await Promise.all(apps.map((app) => app.start()));

	const sum = () =>
		apps.reduce((acc, app) => acc + app.get(TestSchedulerInterval).tick, 0);

	if (lock) {
		await expect
			.poll(() => expect(sum()).toEqual(3), { timeout: 2000 })
			.toBeTruthy();
	} else {
		await expect
			.poll(() => expect(sum()).toEqual(3 * apps.length), { timeout: 2000 })
			.toBeTruthy();
	}

	await Promise.all(apps.map((app) => app.stop()));
};

test("$scheduler - interval", async () => {
	await testSchedulerInterval(true);
});

test("$scheduler - interval no-lock", async () => {
	await testSchedulerInterval(false);
});

test("$scheduler - interval (redis)", { retry: 2 }, async () => {
	await testSchedulerInterval(true, "redis");
});

test("$scheduler - interval no-lock (redis)", async () => {
	await testSchedulerInterval(false, "redis");
});
