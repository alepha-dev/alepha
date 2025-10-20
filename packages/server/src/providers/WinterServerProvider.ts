import { Readable } from "node:stream";
import { $hook, $inject, Alepha } from "@alepha/core";
import { DateTimeProvider } from "@alepha/datetime";
import { $logger } from "@alepha/logger";
import { ServerProvider } from "./ServerProvider.ts";
import { ServerRouterProvider } from "./ServerRouterProvider.ts";

export class WinterServerProvider extends ServerProvider {
	protected readonly alepha = $inject(Alepha);
	protected readonly dateTimeProvider = $inject(DateTimeProvider);
	protected readonly log = $logger();
	protected readonly router = $inject(ServerRouterProvider);

	public get hostname(): string {
		return ``;
	}

	protected readonly onWebRequest = $hook({
		on: "web:request",
		handler: (ev) => {
			return this.handle(ev);
		},
	});

	public async handle(ev: { req: Request; res?: Response }): Promise<void> {
		const req = ev.req;
		const { route, params } = this.router.match(`/${req.method}${req.url}`);

		if (
			// if vite is running
			// and if no route or root-not-found-handler is matched
			// and if the request is for a static file (e.g. .js, .css, etc.)
			this.isViteNotFound(req.url, route, params)
		) {
			// let vite handle the request
			return;
		}

		if (!route) {
			// if no route is found, return basic 404
			// note: you should not use this in production, use a custom 404 page instead by adding a route /*
			ev.res = new Response("Not Found", {
				status: 404,
				headers: { "content-type": "text/plain" },
			});
			return;
		}

		const headers: Record<string, string> = {};
		req.headers.forEach((value, key) => {
			headers[key] = value;
		});

		const request = this.createRouterRequest(
			{
				method: req.method,
				url: req.url,
				headers,
			},
			params,
		);

		const response = await route.handler(request).catch(() => {
			return {
				status: 500,
				headers: { "content-type": "text/plain" },
				body: "Internal Server Error",
			};
		});

		// empty body - just send status & headers
		if (!response.body) {
			ev.res = new Response(null, {
				status: response.status,
				headers: response.headers,
			});
			return;
		}

		// if response.body is string or buffer
		if (typeof response.body === "string") {
			ev.res = new Response(response.body, {
				status: response.status,
				headers: response.headers,
			});
			return;
		}

		if (Buffer.isBuffer(response.body)) {
			ev.res = new Response(response.body.buffer as ArrayBuffer, {
				status: response.status,
				headers: response.headers,
			});
			return;
		}

		// if response.body is node stream
		if (response.body instanceof Readable) {
			ev.res = new Response(Readable.toWeb(response.body) as ReadableStream, {
				status: response.status,
				headers: response.headers,
			});
			return;
		}

		// if response.body is web stream
		if (response.body instanceof ReadableStream) {
			ev.res = new Response(response.body, {
				status: response.status,
				headers: response.headers,
			});
			return;
		}

		// not supported response body type

		this.log.error("Unknown response body type:", typeof response.body);

		ev.res = new Response("Internal Server Error", {
			status: 500,
			headers: { "content-type": "text/plain" },
		});
	}
}
