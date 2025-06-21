import { $logger, Alepha, MockLogger } from "@alepha/core";
import { beforeEach, test } from "vitest";
import { $action, HttpError, ServerLoggerProvider } from "../../src";

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
	.with(ServerLoggerProvider)
	.get(App);

test("ServerLoggerProvider - ok", async ({ expect }) => {
	expect(log.store.stack.length).toBe(0);
	const response = await app.ping.fetch();
	expect(response).toBe("pong");
	expect(log.store.stack[0].msg).toBe("Incoming request");
	expect(log.store.stack[1].msg).toBe("!!");
	expect(log.store.stack[2].msg).toBe("Request completed");
});

test("ServerLoggerProvider - error", async ({ expect }) => {
	expect(log.store.stack.length).toBe(0);
	const response = await app.error.fetch().catch((e) => HttpError.toJSON(e));
	expect(response).toEqual({
		message: "Sorry",
		status: 400,
		error: "BadRequestError",
	});
	expect(log.store.stack[0].msg).toBe("Incoming request");
	expect(log.store.stack[1].msg).toBe("Request has failed");
	expect(log.store.stack[2].msg).toBe("Request completed");
});

test("ServerLoggerProvider - silent", async ({ expect }) => {
	expect(log.store.stack.length).toBe(0);
	const response = await app.silent.fetch();
	expect(response).toBe("silent");
	expect(log.store.stack[0].msg).toBe("this message should be logged");
	expect(log.store.stack.length).toBe(1);
});
