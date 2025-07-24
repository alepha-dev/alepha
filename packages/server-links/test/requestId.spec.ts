import { Alepha, MockLogger } from "@alepha/core";
import { $action, ServerProvider } from "@alepha/server";
import { expect, test } from "vitest";
import { $client, $remote, AlephaServerLinks } from "../src";

test("requestId", async () => {
	const log = new MockLogger();

	class Puppeteer {
		print = $action({
			handler: () => {
				return "Puppeteer is not available in this environment.";
			},
		});
	}

	const p1 = Alepha.create({
		log: log.child({ app: "PPT" }),
	})
		.with(Puppeteer)
		.with(AlephaServerLinks);

	class Reporting {
		puppeteer = $remote({
			url: () => p1.inject(ServerProvider).hostname,
		});

		puppeteerApi = $client<Puppeteer>();

		exportPdf = $action({
			handler: () => {
				return this.puppeteerApi.print();
			},
		});
	}

	const p2 = Alepha.create({
		log: log.child({ app: "RPM" }),
	}).with(Reporting);

	class Frontend {
		reporting = $remote({
			url: () => p2.inject(ServerProvider).hostname,
		});

		reportingApi = $client<Reporting>();

		download = $action({
			handler: () => {
				return this.reportingApi.exportPdf();
			},
		});
	}

	const p3 = Alepha.create({
		log: log.child({ app: "ADM" }),
	}).with(Frontend);

	await p1.start();
	await p2.start();
	await p3.start();

	log.reset();

	await fetch(`${p3.inject(ServerProvider).hostname}/api/download`);

	const uuid = log.store.stack[0].context;
	const logs = log.store.stack.map(
		(it) => `${it.app} - ${it.message} - ${it.context}`,
	);

	expect(logs).toEqual([
		`ADM - Incoming request - ${uuid}`,
		`RPM - Incoming request - ${uuid}`,
		`PPT - Incoming request - ${uuid}`,
		`PPT - Request completed - ${uuid}`,
		`RPM - Request completed - ${uuid}`,
		`ADM - Request completed - ${uuid}`,
	]);
});
