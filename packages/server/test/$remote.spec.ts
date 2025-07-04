import { Alepha } from "@alepha/core";
import { test } from "vitest";
import { $action, $client, $remote, ServerProvider } from "../src";
import { LinkProvider } from "../src/providers/features/LinkProvider.ts";

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

const front = Alepha.create().with(WebApp);

test("$remote", async ({ expect }) => {
	const linkProvider = front.get(LinkProvider);

	expect(await getLinks(c)).toEqual({
		links: [
			{
				group: "service-c",
				name: "print",
				path: "/print",
			},
		],
		prefix: "/api",
	});

	expect(await getLinks(b)).toEqual({
		links: [
			{
				group: "service-b",
				name: "compute",
				path: "/compute",
			},
		],
		prefix: "/api",
	});

	expect(await getLinks(a)).toEqual({
		links: [
			{
				group: "service-a",
				name: "getReport",
				path: "/getReport",
			},
			{
				group: "service-c",
				name: "print",
				path: "/print",
				service: "cr",
			},
		],
		prefix: "/api",
	});

	expect(await getLinks(front)).toEqual({
		links: [
			{
				group: "web-app",
				name: "ping",
				path: "/ping",
			},
			{
				group: "service-a",
				name: "getReport",
				path: "/getReport",
				service: "a",
			},
			{
				group: "service-c",
				name: "print",
				path: "/cr/print",
				service: "a",
			},
		],
		prefix: "/api",
	});

	expect(await linkProvider.client<WebApp>().ping()).toEqual("pong");
	expect(await linkProvider.client<ServiceA>().getReport()).toEqual(
		"B: 42, C: TADA!",
	);
	expect(await linkProvider.client<ServiceC>().print()).toEqual("TADA!");
	await expect(() => linkProvider.client<ServiceB>().compute()).rejects.toThrow(
		"Action compute not found",
	);
});

const getLinks = (a: Alepha) =>
	fetch(`${a.get(ServerProvider).hostname}/api/_links`).then((res) =>
		res.json(),
	);
