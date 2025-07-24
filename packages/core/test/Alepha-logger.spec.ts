import { test } from "vitest";
import { $logger, Alepha } from "../src";

test("Alepha#logger", () => {
	new Alepha({ env: { NODE_ENV: "dev" } }).log.trace("test");
	new Alepha({ env: { NODE_ENV: "production" } }).log.trace("test");
	new Alepha({ env: { NODE_ENV: "test" } }).log.trace("test");
});

test("Alepha#logger - descriptor", () => {
	class A {
		log = $logger();
	}

	new Alepha().inject(A).log.trace("test");
});
