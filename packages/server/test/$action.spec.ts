import { Alepha, t } from "@alepha/core";
import { describe, test } from "vitest";
import { $action, ServerRouterProvider } from "../src";

describe("$action", () => {
	test("should expose api", async ({ expect }) => {
		class Api {
			hello = $action({
				schema: {
					params: t.object({
						name: t.string(),
					}),
					query: t.object({
						transform: t.optional(t.enum(["uppercase"])),
					}),
					response: t.object({
						message: t.string(),
					}),
				},
				handler: ({ params, query }) => {
					const message = `Hello ${params.name}`;
					if (query.transform === "uppercase") {
						return {
							message: message.toUpperCase(),
						};
					}
					return { message };
				},
			});
		}

		const alepha = Alepha.create();
		const app = alepha.inject(Api);
		await alepha.start();

		expect(await app.hello.run({ params: { name: "John" } })).toStrictEqual({
			message: "Hello John",
		});

		expect(
			await app.hello.run({
				params: { name: "John" },
				query: { transform: "uppercase" },
			}),
		).toStrictEqual({
			message: "HELLO JOHN",
		});

		expect(
			await app.hello.fetch({ params: { name: "John" } }).then((it) => it.data),
		).toStrictEqual({
			message: "Hello John",
		});

		expect(
			await app.hello
				.fetch({
					params: { name: "John" },
					query: { transform: "uppercase" },
				})
				.then((it) => it.data),
		).toStrictEqual({
			message: "HELLO JOHN",
		});
	});

	test("should not be exposed when disabled", async ({ expect }) => {
		const alepha = Alepha.create();
		class TestApp {
			a1 = $action({
				handler: () => "ok:a1",
			});
			a2 = $action({
				handler: () => "ok:a2",
				disabled: true,
			});
		}
		const app = alepha.inject(TestApp);
		await alepha.start();

		expect(await app.a1.fetch({}).then((it) => it.data)).toBe("ok:a1");
		expect(await app.a2.fetch({}).then((it) => it.data)).toBe("Not Found");
		// note: $action disabled is callable locally
		expect(await app.a2.run({})).toBe("ok:a2");
	});
});
