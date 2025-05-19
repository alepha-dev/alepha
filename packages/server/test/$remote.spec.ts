import { Alepha } from "@alepha/core";
import { test } from "vitest";
import { $action, $remote, HttpClient, ServerProvider } from "../src";
import { $client } from "../src/descriptors/$client.ts";

class ServiceC {
	print = $action({
		handler: () => "TADA!",
	});
}

const c = Alepha.create().with(ServiceC);

class ServiceB {
	compute = $action({
		handler: () => {
			return "42";
		},
	});
}

const b = Alepha.create().with(ServiceB);

class ServiceA {
	br = $remote({
		url: () => b.get(ServerProvider).hostname,
	});

	cr = $remote({
		url: () => c.get(ServerProvider).hostname,
		proxy: true,
	});

	sb = $client<ServiceB>();
	sc = $client<ServiceC>();

	getReport = $action({
		handler: async () => {
			const b = await this.sb.compute();
			const c = await this.sc.print();
			return `B: ${b}, C: ${c}`;
		},
	});
}

const a = Alepha.create().with(ServiceA);

class WebApp {
	a = $remote({
		url: () => a.get(ServerProvider).hostname,
		proxy: true,
	});

	ping = $action({
		handler: async () => {
			return "pong";
		},
	});
}

const webApp = Alepha.create().with(WebApp);

test("$remote", async ({ expect }) => {
	const client = webApp.get(HttpClient);
	const links = await client.getLinks();
	expect(links.map((link) => link.path)).toEqual([
		"/api/print",
		"/api/getReport",
		"/api/ping",
	]);

	expect(await client.of<WebApp>().ping()).toEqual("pong");
	expect(await client.of<ServiceC>().print()).toEqual("TADA!");
	expect(await client.of<ServiceA>().getReport()).toEqual("B: 42, C: TADA!");
	await expect(() => client.of<ServiceB>().compute()).rejects.toThrow(
		"Action compute not found",
	);
});
