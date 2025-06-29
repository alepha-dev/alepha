import {
	$inject,
	Alepha,
	type Service,
	type ServiceEntry,
	t,
} from "@alepha/core";
import { expect } from "vitest";
import {
	$subscriber,
	$topic,
	MemoryTopicProvider,
	type SubscribeCallback,
	TopicProvider,
} from "../src";

export const payloadSchema = t.object({
	id: t.string(),
	count: t.uint(),
});

export const subscriptions: Record<string, SubscribeCallback[]> = {};
export class SharedTopicProvider extends MemoryTopicProvider {
	subscriptions = subscriptions;
}

export const testTopicBasic = async (provider: Service<TopicProvider>) => {
	class TestTopic {
		t = $topic({
			name: "test",
			schema: {
				payload: payloadSchema,
			},
		});
	}

	class TestSubscriber {
		stack: string[] = [];
		test = $inject(TestTopic);
		s = $subscriber({
			topic: this.test.t,
			handler: async (m) => {
				this.stack.push(m.payload.id + m.payload.count);
			},
		});
	}

	const createApp = async <T extends object>(
		testClass: ServiceEntry<T>,
	): Promise<{ app: Alepha; test: T }> => {
		const app = Alepha.create();

		app.with({
			provide: TopicProvider,
			use: provider,
		});

		const test = app.get(testClass);

		await app.start();

		return { app, test };
	};

	const { app: app1, test: test1 } = await createApp(TestTopic);
	const { app: app2, test: test2 } = await createApp(TestTopic);
	const { app: app3, test: test3 } = await createApp(TestSubscriber);
	const { app: app4, test: test4 } = await createApp(TestSubscriber);

	await test1.t.publish({ id: "1", count: 2 });
	await test2.t.publish({ id: "2", count: 3 });

	await Promise.all([
		expect.poll(() => expect(test3.stack).toEqual(["12", "23"])).toBeTruthy(),
		expect.poll(() => expect(test4.stack).toEqual(["12", "23"])).toBeTruthy(),
	]);

	await app1.stop();
	await app2.stop();
	await app3.stop();
	await app4.stop();
};

export const testTopicAsSub = async (provider: Service<TopicProvider>) => {
	let count = 0;
	class A {
		t = $topic({
			name: "a",
			schema: {
				payload: t.object({ n: t.uint() }),
			},
			handler: async ({ payload }) => {
				count += payload.n;
			},
		});
	}

	const app = Alepha.create({})
		.with({
			provide: TopicProvider,
			use: provider,
		})
		.with(A);

	await app.start();

	const a = app.get(A);

	await a.t.publish({ n: 123 });

	await expect.poll(() => expect(count).toBe(123)).toBeTruthy();
};
