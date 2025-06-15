import type { ServiceEntry } from "@alepha/core";
import { $inject, Alepha, t } from "@alepha/core";
import { expect, test } from "vitest";
import {
	$consumer,
	$queue,
	MemoryQueueProvider,
	QueueDescriptorProvider,
	QueueProvider,
	RedisQueueProvider,
} from "../src";

const payloadSchema = t.object({
	id: t.string(),
	count: t.uint(),
});

const testQueueBasic = async (provider?: "redis") => {
	const queueList: Record<string, string[]> = {};

	class SharedQueueProvider extends MemoryQueueProvider {
		queueList = queueList;
	}

	class TestQueue {
		q = $queue({
			name: "test",
			schema: {
				payload: payloadSchema,
			},
		});
	}

	class TestConsumer {
		stack: string[] = [];
		test = $inject(TestQueue);
		s = $consumer({
			queue: this.test.q,
			handler: async (m) => {
				this.stack.push(m.payload.id + m.payload.count);
			},
		});
	}

	const createApp = async <T extends object>(
		testClass: ServiceEntry<T>,
		provider?: "redis",
	): Promise<{ app: Alepha; test: T }> => {
		const app = Alepha.create({
			env: {
				QUEUE_WORKER_INTERVAL: 10,
			},
		});

		app.with({
			provide: QueueProvider,
			use: provider === "redis" ? RedisQueueProvider : SharedQueueProvider,
		});

		const test = app.get(testClass);

		await app.start();

		return { app, test };
	};

	const { app: app1, test: test1 } = await createApp(TestQueue, provider);
	const { app: app2, test: test2 } = await createApp(TestQueue, provider);
	const { app: app3, test: test3 } = await createApp(TestConsumer, provider);

	await test1.q.push({ id: "1", count: 2 });
	await test2.q.push({ id: "2", count: 3 });

	await expect
		.poll(() => expect(test3.stack).toEqual(["12", "23"]))
		.toBeTruthy();

	await app1.stop();
	await app2.stop();
	await app3.stop();
};

test("$queue - basic", async () => {
	await testQueueBasic();
});

test("$queue - basic (redis)", async () => {
	await testQueueBasic("redis");
});

test("$queue - has consumer", async () => {
	let count = 0;
	class A {
		q = $queue({
			schema: {
				payload: t.object({ n: t.uint() }),
			},
			handler: async ({ payload }) => {
				count += payload.n;
			},
		});
	}
	const app = new Alepha().with(A);
	await app.start();
	expect(count).toBe(0);

	await app.get(A).q.push({ n: 123 });
	await expect.poll(() => expect(count).toBe(123)).toBeTruthy();
});

test("$queue - kill worker sleep", async () => {
	let count = 0;
	class A {
		q = $queue({
			schema: {
				payload: t.object({}),
			},
		});
		c = $consumer({
			queue: this.q,
			handler: async () => {},
		});
	}

	const app = Alepha.create({
		env: {
			QUEUE_WORKER_INTERVAL: 20000,
		},
	})
		.with({
			provide: QueueProvider,
			use: MemoryQueueProvider,
		})
		.with({
			provide: QueueDescriptorProvider,
			use: class extends QueueDescriptorProvider {
				async stopWorkers() {
					await super.stopWorkers();
					count += 123;
				}
			},
		})
		.with(A);

	expect(count).toBe(0);
	await app.start();
	expect(count).toBe(0);

	await app.stop();
	expect(count).toBe(123);
});
