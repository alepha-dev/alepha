import { expect, test } from "vitest";
import { $env, $hook, $inject, Alepha, ContainerLockedError, t } from "../src";

/**
 * Start the application.
 *
 * Start act like a lock, it will prevent any further registration.
 */
test("Alepha#start - basic", async () => {
	const app = await Alepha.create().start();

	// Start again has no effect.
	await app.start();
	await app.start();
});

test("Alepha#start - lock", async () => {
	class A {
		a = "a";
		e = $env(
			t.object({
				HELLO: t.string(),
			}),
		);
	}

	const app = await Alepha.create({ env: { HELLO: "WORLD", MISSING: "123" } })
		.with(A)
		.start();

	// you can't register after start.
	expect(() => app.with(class {})).toThrow(ContainerLockedError);

	// you can't get after start.
	expect(() => app.get(class {})).toThrow(ContainerLockedError);
});

/**
 * B -> A so:
 *
 * - B should be configured after A.
 * - B should be started after A.
 *
 * But also:
 * - B should be stopped before A.
 */
test("Alepha#start - hooks", async () => {
	const stack: string[] = [];

	class A {
		onConfigure = $hook({
			on: "configure",
			handler: async () => {
				stack.push("A.configure");
			},
		});

		onStart = $hook({
			on: "start",
			handler: async () => {
				stack.push("A.start");
			},
		});

		onStop = $hook({
			on: "stop",
			handler: async () => {
				stack.push("A.stop");
			},
		});
	}

	class B {
		a = $inject(A);

		onConfigure = $hook({
			on: "configure",
			handler: async () => {
				stack.push("B.configure");
			},
		});

		onStart = $hook({
			on: "start",
			handler: async () => {
				stack.push("B.start");
			},
		});

		onStop = $hook({
			on: "stop",
			handler: async () => {
				stack.push("B.stop");
			},
		});
	}

	const app = await Alepha.create().with(B).start();

	await app.start();
	await app.start();

	expect(stack).toEqual(["A.configure", "B.configure", "A.start", "B.start"]);

	await app.stop();

	expect(stack).toEqual([
		"A.configure",
		"B.configure",
		"A.start",
		"B.start",
		"B.stop",
		"A.stop",
	]);

	await app.stop();

	expect(stack).toEqual([
		"A.configure",
		"B.configure",
		"A.start",
		"B.start",
		"B.stop",
		"A.stop",
	]);
});

test("Alepha#start - restart", async () => {
	let count = 0;

	const alepha = Alepha.create().with(
		class App {
			configure = $hook({
				on: "configure",
				handler: () => {
					count += 10;
				},
			});

			start = $hook({
				on: "start",
				handler: () => {
					count += 100;
				},
			});

			stop = $hook({
				on: "stop",
				handler: () => {
					count += 1000;
				},
			});
		},
	);

	expect(alepha.isConfigured()).toBe(false);
	expect(alepha.isLocked()).toBe(false);
	expect(alepha.isStarted()).toBe(false);
	expect(count).toBe(0);

	await alepha.start();

	expect(alepha.isConfigured()).toBe(true);
	expect(alepha.isLocked()).toBe(true);
	expect(alepha.isStarted()).toBe(true);
	expect(count).toBe(110);

	await alepha.stop();

	expect(alepha.isConfigured()).toBe(true);
	expect(alepha.isLocked()).toBe(true);
	expect(alepha.isStarted()).toBe(false);
	expect(count).toBe(1110);

	await alepha.start();

	expect(alepha.isConfigured()).toBe(true);
	expect(alepha.isLocked()).toBe(true);
	expect(alepha.isStarted()).toBe(true);
	expect(count).toBe(1220);
});
