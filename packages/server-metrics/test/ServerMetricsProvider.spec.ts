import { Alepha } from "@alepha/core";
import { ServerProvider } from "@alepha/server";
import { test } from "vitest";
import { AlephaServerMetrics } from "../src";

test("ServerMetricsProvider", async ({ expect }) => {
	const alepha = Alepha.create().with(AlephaServerMetrics);
	await alepha.start();

	const resp = await fetch(`${alepha.inject(ServerProvider).hostname}/metrics`);

	expect(resp.status).toBe(200);
	const text = await resp.text();

	expect(text).toContain("process_cpu_system_seconds_total");
	expect(text).toContain("process_cpu_seconds_total");
	expect(text).toContain("process_start_time_seconds");
	// etc...
});
