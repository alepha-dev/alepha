import { Alepha } from "@alepha/core";
import { describe, test } from "vitest";
import { $route, ServerProvider } from "../src";

describe("$route", () => {
	/**
	 * $route is not important, but it is a good "minimal" example.
	 */
	test("should return the correct route", async ({ expect }) => {
		const alepha = Alepha.create();

		class TestApp {
			$route = $route({
				path: "/hello",
				handler: () => "OK",
			});
		}

		await alepha.with(TestApp).start();

		const resp = await fetch(`${alepha.inject(ServerProvider).hostname}/hello`);
		expect(await resp.text()).toBe("OK");
	});
});
