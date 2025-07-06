import { Alepha, t } from "@alepha/core";
import { test } from "vitest";
import { $action } from "../src";

class App {
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

test("ActionProvider", async ({ expect }) => {
	const alepha = Alepha.create();
	const app = alepha.get(App);
	await alepha.start();

	expect(await app.hello({ params: { name: "John" } })).toStrictEqual({
		message: "Hello John",
	});

	expect(
		await app.hello({
			params: { name: "John" },
			query: { transform: "uppercase" },
		}),
	).toStrictEqual({
		message: "HELLO JOHN",
	});
});
