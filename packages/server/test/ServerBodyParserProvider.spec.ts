import { Alepha, t } from "@alepha/core";
import { describe, test } from "vitest";
import { $action, HttpError } from "../src";

describe("ServerBodyParserProvider", () => {
	test("should handle simple json body", async ({ expect }) => {
		const alepha = Alepha.create();

		class TestApp {
			test = $action({
				schema: {
					body: t.object({
						message: t.string(),
					}),
					response: t.object({
						received: t.string(),
					}),
				},
				handler: ({ body }) => {
					return { received: body.message };
				},
			});
		}

		const app = alepha.inject(TestApp);
		await alepha.start();

		expect(
			await app.test.run({
				body: { message: "Hello, World!" },
			}),
		).toEqual({
			received: "Hello, World!",
		});
	});

	test("should reject big payload", async ({ expect }) => {
		const alepha = Alepha.create();

		class TestApp {
			test = $action({
				schema: {
					body: t.object({
						message: t.string({
							maxLength: 1000000, // allow up to 1 million characters (for http client validation)
						}),
					}),
					response: t.object({
						received: t.string(),
					}),
				},
				handler: ({ body }) => {
					return { received: body.message };
				},
			});
		}

		const app = alepha.inject(TestApp);
		await alepha.start();

		expect(
			await app.test
				.fetch({
					body: { message: "A".repeat(1000000) },
				})
				.catch((e) => HttpError.toJSON(e)),
		).toEqual({
			error: "PayloadTooLargeError",
			status: 413,
			message: "Request body size limit exceeded",
		});
	});
});
