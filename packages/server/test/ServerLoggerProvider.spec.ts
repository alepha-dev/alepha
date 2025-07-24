import { $logger, Alepha, MockLogger } from "@alepha/core";
import { beforeEach, test } from "vitest";
import { AlephaServer } from "../src";
import { $action } from "../src/descriptors/$action.ts";
import { HttpError } from "../src/errors/HttpError.ts";
import { ServerLoggerProvider } from "../src/providers/features/ServerLoggerProvider.ts";

class App {
	log = $logger();
	ping = $action({
		handler: () => {
			this.log.info("!!");
			return "pong";
		},
	});
	silent = $action({
		silent: true,
		handler: () => {
			this.log.info("this message should be logged");
			return "silent";
		},
	});
	error = $action({
		handler: () => {
			throw new HttpError({
				message: "Sorry",
				status: 400,
			});
		},
	});
}

beforeEach(() => {
	log.store.stack = [];
});

const log = new MockLogger();
const app = Alepha.create({
	log,
})
	.with(AlephaServer)
	.with(ServerLoggerProvider)
	.inject(App);

test("ServerLoggerProvider - ok", async ({ expect }) => {
	expect(log.store.stack.length).toBe(0);
	const response = await app.ping.fetch();
	expect(response.data).toBe("pong");
	expect(log.store.stack[0].message).toBe("Incoming request");
	expect(log.store.stack[1].message).toBe("!!");
	expect(log.store.stack[2].message).toBe("Request completed");
});

test("ServerLoggerProvider - error", async ({ expect }) => {
	expect(log.store.stack.length).toBe(0);
	const response = await app.error
		.fetch()
		.then((it) => it.data)
		.catch((e) => HttpError.toJSON(e));

	expect(response).toEqual({
		message: "Sorry",
		status: 400,
		error: "BadRequestError",
	});
	expect(log.store.stack[0].message).toBe("Incoming request");
	expect(log.store.stack[1].message).toBe("Request has failed");
	expect(log.store.stack[2].message).toBe("Request completed");
});

test("ServerLoggerProvider - silent", async ({ expect }) => {
	expect(log.store.stack.length).toBe(0);
	const response = await app.silent.fetch();
	expect(response.data).toBe("silent");
	expect(log.store.stack[0].message).toBe("this message should be logged");
	expect(log.store.stack.length).toBe(1);
});
