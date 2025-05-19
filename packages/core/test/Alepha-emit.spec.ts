import { test } from "vitest";
import { Alepha } from "../src";

test("Alepha#emit - catch", async ({ expect }) => {
	const alepha = Alepha.create();

	alepha.on("echo", () => {
		throw new Error("Error in echo");
	});

	await alepha.start();

	await expect(() => alepha.emit("echo", {})).rejects.toThrowError(
		"Error in echo",
	);

	expect(await alepha.emit("echo", {}, { catch: true })).toEqual(undefined);
});
