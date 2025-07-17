import { randomUUID } from "node:crypto";
import { $env, Alepha, type ServiceEntry, t } from "@alepha/core";
import { DateTimeProvider } from "@alepha/datetime";
import { LockProvider, MemoryLockProvider } from "@alepha/lock";
import { RedisLockProvider } from "@alepha/lock-redis";
import { expect, test } from "vitest";
import { $scheduler } from "../src";

const store: Record<string, string> = {};

class SharedLockProvider extends MemoryLockProvider {
	store = store;
}

const env = t.object({
	LOCK: t.boolean(),
});

class TestSchedulerInterval {
	env = $env(env);
	tick = 0;
	t = $scheduler({
		interval: [1, "minute"],
		lock: this.env.LOCK,
		handler: async () => {
			this.tick += 1;
		},
	});
}

const createApp = <T extends object>(
	testClass: ServiceEntry<T>,
	LOCK: boolean,
	provider?: "redis",
	prefix?: string,
): Alepha => {
	return Alepha.create({ env: { LOCK, LOCK_PREFIX_KEY: prefix } })
		.with({
			provide: LockProvider,
			use: provider === "redis" ? RedisLockProvider : SharedLockProvider,
		})
		.with(DateTimeProvider)
		.with(testClass);
};

const testSchedulerInterval = async (lock: boolean, provider?: "redis") => {
	const prefix = randomUUID();
	const apps = [
		createApp(TestSchedulerInterval, lock, provider, prefix),
		createApp(TestSchedulerInterval, lock, provider, prefix),
		createApp(TestSchedulerInterval, lock, provider, prefix),
		createApp(TestSchedulerInterval, lock, provider, prefix),
	];

	await Promise.all(apps.map((app) => app.start()));

	const sum = () =>
		apps.reduce((acc, app) => acc + app.get(TestSchedulerInterval).tick, 0);

	await Promise.all(
		apps.map((app) => app.get(DateTimeProvider).travel(64, "seconds")),
	);

	await new Promise((r) => setTimeout(r, 100));

	if (lock) {
		await expect.poll(() => expect(sum()).toEqual(1)).toBeTruthy();
	} else {
		await expect
			.poll(() => expect(sum()).toEqual(1 * apps.length))
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

test("$scheduler - interval (redis)", async () => {
	await testSchedulerInterval(true, "redis");
});

test("$scheduler - interval no-lock (redis)", async () => {
	await testSchedulerInterval(false, "redis");
});
