import { $hook, Alepha } from "@alepha/core";
import { expect, test } from "vitest";
import { $interval, DateTimeProvider } from "../src";

test("$interval - basic", async () => {
	let count = 0;
	class Dummy {
		loop = $interval({
			duration: [10, "seconds"],
			handler: () => {
				count += 1;
			},
		});
	}

	const app = Alepha.create().with(Dummy);
	const dt = app.get(DateTimeProvider);

	expect(count).toBe(0);
	await app.start();
	expect(count).toBe(1);

	await dt.travel([50, "seconds"]);
	expect(count).toBe(6);
});

test("$interval - abort", async () => {
	let count = 0;
	class Dummy {
		loop = $interval({
			duration: [10, "seconds"],
			handler: () => {
				count += 1;
			},
		});
	}

	const app = Alepha.create().with(Dummy);
	expect(count).toBe(0);

	await app.start();
	expect(count).toBe(1);

	await app.stop();
	expect(count).toBe(1);
});

test("Alepha#start - flags", async () => {
	const app = Alepha.create();
	const dt = app.get(DateTimeProvider);

	expect(app.isStarted()).toBe(false);
	expect(app.isConfigured()).toBe(false);
	expect(app.isLocked()).toBe(false);

	const blocker = {
		release: () => {},
	};

	const end = new Promise<void>((resolve) => {
		blocker.release = resolve;
	});

	class LongStart {
		_ = $hook({
			on: "start",
			handler: async () => {
				blocker.release();
				await dt.wait([1, "minute"]);
			},
		});
	}

	const startEnd = app.with(LongStart).start();

	await end;

	expect(app.isLocked()).toBe(true);
	expect(app.isStarted()).toBe(false);

	await dt.travel([1, "minute"]);
	await startEnd;

	expect(app.isStarted()).toBe(true);
	expect(app.isLocked()).toBe(true);
});
