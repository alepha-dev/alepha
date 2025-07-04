import { Alepha } from "@alepha/core";
import { ServerProvider } from "@alepha/server";
import { expect, test } from "vitest";
import { AlephaServerHealth } from "../src";

const alepha = Alepha.create().with(AlephaServerHealth);

test("Alepha Server Health Module", async () => {
	const srv = alepha.get(ServerProvider);
	const hostname = srv.hostname;

	const ping = await fetch(`${hostname}/health`);

	expect(await ping.json()).toEqual({
		message: "OK",
		uptime: expect.any(Number),
		date: expect.any(String),
		ready: true,
	});
});
