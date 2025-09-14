import { test } from "vitest";
import { Alepha } from "../src";

test("alepha.events.emit - catch", async ({ expect }) => {
	const alepha = Alepha.create();

	alepha.events.on("echo", () => {
		throw new Error("Error in echo");
	});

	await alepha.start();

	await expect(() => alepha.events.emit("echo", {})).rejects.toThrowError(
		"Error in echo",
	);

	expect(await alepha.events.emit("echo", {}, { catch: true })).toEqual(
		undefined,
	);
});
