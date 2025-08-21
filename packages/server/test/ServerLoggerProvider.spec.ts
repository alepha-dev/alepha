import { Alepha } from "@alepha/core";
import {
	$logger,
	LogDestinationProvider,
	MemoryDestinationProvider,
} from "@alepha/logger";
import { beforeEach, test } from "vitest";
import { AlephaServer } from "../src";
import { $action } from "../src/descriptors/$action.ts";
import { HttpError } from "../src/errors/HttpError.ts";
import { ServerLoggerProvider } from "../src/providers/ServerLoggerProvider.ts";

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

const alepha = Alepha.create({
	env: {
		LOG_LEVEL: "info",
	},
})
	.with({
		provide: LogDestinationProvider,
		use: MemoryDestinationProvider,
	})
	.with(AlephaServer)
	.with(ServerLoggerProvider);

const app = alepha.inject(App);
const log = alepha.inject(MemoryDestinationProvider);

beforeEach(() => {
	log.clear();
});

test("ServerLoggerProvider - ok", async ({ expect }) => {
	expect(log.logs.length).toBe(0);
	const response = await app.ping.fetch();
	expect(response.data).toBe("pong");
	expect(log.logs[0].message).toBe("Incoming request");
	expect(log.logs[1].message).toBe("!!");
	expect(log.logs[2].message).toBe("Request completed");
});

test("ServerLoggerProvider - error", async ({ expect }) => {
	expect(log.logs.length).toBe(0);
	const response = await app.error
		.fetch()
		.then((it) => it.data)
		.catch((e) => HttpError.toJSON(e));

	expect(response).toEqual({
		message: "Sorry",
		status: 400,
		error: "BadRequestError",
	});
	expect(log.logs[0].message).toBe("Incoming request");
	expect(log.logs[1].message).toBe("Request has failed");
	expect(log.logs[2].message).toBe("Request completed");
});

test("ServerLoggerProvider - silent", async ({ expect }) => {
	expect(log.logs.length).toBe(0);
	const response = await app.silent.fetch();
	expect(response.data).toBe("silent");
	expect(log.logs[0].message).toBe("this message should be logged");
	expect(log.logs.length).toBe(1);
});
