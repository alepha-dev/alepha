import { $hook, Alepha } from "@alepha/core";
import { expect, test } from "vitest";
import { $interval, DateTimeProvider } from "../src";

test("$interval - basic", async () => {
	const count = { value: 0 };
	class TestApp {
		loop = $interval({
			run: "start",
			duration: [10, "seconds"],
			handler: () => {
				console.log("Loop executed");
				count.value += 1;
			},
		});
	}

	const alepha = Alepha.create({
		env: {
			LOG_LEVEL: "trace",
		},
	});
	const dt = alepha.get(DateTimeProvider);
	const app = alepha.get(TestApp);
	expect(app.loop.called).toBe(0);
	expect(count.value).toBe(0);

	expect(app.loop.called).toBe(0);
	expect(count.value).toBe(0);
	await alepha.start();
	await new Promise((resolve) => setTimeout(resolve, 50));
	expect(app.loop.called).toBe(1);
	expect(count.value).toBe(1);

	await dt.travel([50, "seconds"]);
	expect(app.loop.called).toBe(6);
	expect(count.value).toBe(6);
});

test("$interval - abort", async () => {
	const count = { value: 0 };
	class TestApp {
		loop = $interval({
			duration: [10, "seconds"],
			handler: () => {
				count.value += 1;
			},
		});
	}

	const alepha = Alepha.create();
	const app = alepha.get(TestApp);
	expect(app.loop.called).toBe(0);
	expect(count.value).toBe(0);

	await alepha.start();
	expect(app.loop.called).toBe(1);
	expect(count.value).toBe(1);

	await alepha.stop();
	expect(app.loop.called).toBe(1);
	expect(count.value).toBe(1);
});

test("Alepha#start - flags", async () => {
	const app = Alepha.create({});
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
