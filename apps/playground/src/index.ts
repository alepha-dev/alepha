import { Alepha } from "@alepha/core";
import { $action, ServerProvider } from "@alepha/server";
import { $client, $remote, AlephaServerLinks } from "@alepha/server-links";

class Puppeteer {
	print = $action({
		handler: () => {
			return "Puppeteer is not available in this environment.";
		},
	});
}

const p1 = Alepha.create({
	env: { SERVER_PORT: 0, APP_NAME: "PPT" },
})
	.with(Puppeteer)
	.with(AlephaServerLinks);

class Reporting {
	puppeteer = $remote({
		url: () => p1.get(ServerProvider).hostname,
	});

	puppeteerApi = $client<Puppeteer>();

	exportPdf = $action({
		handler: () => {
			return this.puppeteerApi.print();
		},
	});
}

const p2 = Alepha.create({
	env: { SERVER_PORT: 0, APP_NAME: "RPM" },
}).with(Reporting);

class Frontend {
	reporting = $remote({
		url: () => p2.get(ServerProvider).hostname,
	});

	reportingApi = $client<Reporting>();

	download = $action({
		handler: () => {
			return this.reportingApi.exportPdf();
		},
	});
}

const p3 = Alepha.create({
	env: { SERVER_PORT: 3000, APP_NAME: "ADM" },
}).with(Frontend);

(async () => {
	await p1.start();
	await p2.start();
	await p3.start();
})();
