import { expect, test } from "vitest";
import { $hook, $inject, Alepha, ContainerLockedError, t } from "../src";

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
		e = $inject(
			t.object({
				HELLO: t.string(),
			}),
		);
	}

	const app = await Alepha.create({ env: { HELLO: "WORLD", MISSING: "123" } })
		.with(A)
		.start();

	// you can't register after start.
	expect(() => app.register(class {})).toThrow(ContainerLockedError);

	// you can't get after start.
	expect(() => app.get(class {})).toThrow(ContainerLockedError);

	// you can't swap after start.
	expect(() =>
		app.get({
			provide: A,
			use: class extends A {
				a = "z";
			},
		}),
	).toThrow(ContainerLockedError);
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
			name: "configure",
			handler: async () => {
				stack.push("A.configure");
			},
		});

		onStart = $hook({
			name: "start",
			handler: async () => {
				stack.push("A.start");
			},
		});

		onStop = $hook({
			name: "stop",
			handler: async () => {
				stack.push("A.stop");
			},
		});
	}

	class B {
		a = $inject(A);

		onConfigure = $hook({
			name: "configure",
			handler: async () => {
				stack.push("B.configure");
			},
		});

		onStart = $hook({
			name: "start",
			handler: async () => {
				stack.push("B.start");
			},
		});

		onStop = $hook({
			name: "stop",
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

// Not sure if this is a good idea. Disabled for now
//
// test("Alepha#start - clean up when failure", async () => {
// 	let count = 0;
//
// 	class A {
// 		start = $hook({ name: "start", handler: () => (count += 10) });
// 		stop = $hook({ name: "stop", handler: () => (count -= 1) });
// 	}
//
// 	class B extends A {}
//
// 	class C extends A {
// 		start = $hook({
// 			name: "start",
// 			handler: () => {
// 				throw new Error("BOOM");
// 			},
// 		});
// 	}
//
// 	class D extends A {}
//
// 	expect(count).toBe(0);
//
// 	const app = Alepha.create({ env: {
// 		LOG_LEVEL: "silent",
// 	}})
// 		.with(A)
// 		.with(B)
// 		.with(C)
// 		.with(D);
//
// 	expect(count).toBe(0);
//
// 	await expect(app.start()).rejects.toThrow("BOOM");
//
// 	expect(count).toBe(10 + 10 - 1 - 1);
// });

test("Alepha#start - restart", async () => {
	let count = 0;

	const alepha = Alepha.create().with(
		class App {
			configure = $hook({
				name: "configure",
				handler: () => {
					count += 10;
				},
			});

			start = $hook({
				name: "start",
				handler: () => {
					count += 100;
				},
			});

			stop = $hook({
				name: "stop",
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
	expect(count).toBe(1210);
});
