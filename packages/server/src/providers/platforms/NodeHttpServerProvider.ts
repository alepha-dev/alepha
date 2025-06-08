import type { IncomingMessage } from "node:http";
import { type ServerResponse, createServer } from "node:http";
import { Readable } from "node:stream";
import { $hook, $inject, $logger, Alepha, type Static, t } from "@alepha/core";
import type { RouteMethod } from "../../constants/routeMethods.ts";
import {
	type ServerRawRequest,
	ServerRouterProvider,
} from "../ServerRouterProvider.ts";
import type { ServerProvider } from "./ServerProvider.ts";

const envSchema = t.object({
	SERVER_PORT: t.uint({
		default: 3000,
		min: 0,
		max: 65535,
		description: "Set 0 to listen on a random port.",
	}),
	SERVER_HOST: t.string({
		default: "localhost",
		description: "Set 0.0.0.0 to listen on all interfaces.",
	}),
});

declare module "@alepha/core" {
	interface Env extends Partial<Static<typeof envSchema>> {}
}

export class NodeHttpServerProvider implements ServerProvider {
	protected readonly alepha = $inject(Alepha);
	protected readonly log = $logger();
	protected readonly env = $inject(envSchema);
	protected readonly router = $inject(ServerRouterProvider);

	protected readonly server = createServer((req, res) => this.handle(req, res));

	public async handle(
		req: IncomingMessage,
		res: ServerResponse,
	): Promise<number | void> {
		const { route, params } = this.router.match(`/${req.method}${req.url}`);

		if (!route && this.alepha.isServerless() === "vite") {
			// if vite is running, let it handle the request
			return;
		}

		if (!route) {
			// if no route is found, return basic 404
			// note: you should not use this in production, use a custom 404 page instead by adding a route /*
			res.writeHead(404, { "content-type": "text/plain" });
			res.end("Not Found");
			return 404;
		}

		const request = this.createRouterRequest(req, res, params);
		const response = await route.handler(request).catch(() => {
			return {
				status: 500,
				headers: { "content-type": "text/plain" },
				body: "Internal Server Error",
			};
		});

		res.writeHead(response.status, response.headers);

		// empty body, just end the response
		if (!response.body) {
			res.end();
			return response.status;
		}

		// if response.body is web stream
		if (response.body instanceof ReadableStream) {
			Readable.from(response.body).pipe(res);
			return response.status;
		}

		// if response.body is stream
		if (response.body instanceof Readable) {
			response.body.pipe(res);
			return response.status;
		}

		// else
		res.end(response.body);
		return response.status;
	}

	public createRouterRequest(
		req: IncomingMessage,
		res: ServerResponse,
		params: Record<string, string> = {},
	): ServerRawRequest {
		const url = new URL(
			`${this.getProtocol(req)}://${req.headers.host}${req.url}`,
		);
		const query = Object.fromEntries(url.searchParams.entries());
		const headers = req.headers as Record<string, string>;
		const method = (req.method?.toUpperCase() ?? "GET") as RouteMethod;

		return {
			method,
			url,
			headers,
			params,
			query,
			raw: {
				node: {
					req,
					res,
				},
			},
		};
	}

	public getProtocol(req: IncomingMessage): "http" | "https" {
		if (req.headers["x-forwarded-proto"] === "https") {
			return "https";
		}
		return "http";
	}

	public shouldHaveBody(method: string): boolean {
		return method === "POST" || method === "PUT" || method === "PATCH";
	}

	public get hostname(): string {
		if (this.server.listening) {
			const address = this.server.address();
			if (typeof address === "object" && address !== null) {
				return `http://${this.env.SERVER_HOST}:${address.port}`;
			}
		}
		return `http://${this.env.SERVER_HOST}:${this.env.SERVER_PORT}`;
	}

	public readonly start = $hook({
		name: "start",
		handler: async () => {
			await this.listen();
		},
	});

	protected readonly stop = $hook({
		name: "stop",
		handler: async () => {
			if (this.alepha.isServerless()) {
				return;
			}

			if (this.alepha.isProduction()) {
				await this.close();
				return;
			}

			// do not await in development & test
			this.close().catch();
		},
	});

	protected async listen() {
		if (this.alepha.isServerless()) {
			// attach handler to the serverless function
			this.alepha.handle = (req, res) => this.handle(req, res);
			// and do not start the server, it will be started by the serverless provider
			return;
		}

		let port = this.env.SERVER_PORT;

		// for testing, use a random port if port is 3000 (default)
		if (this.alepha.isTest() && port === 3000) {
			port = 0;
		}

		await new Promise<void>((resolve, reject) => {
			this.server?.listen(port, this.env.SERVER_HOST, () => {
				this.log.info(`Server listening on ${this.hostname}`);
				resolve();
			});

			this.server?.on("error", (err) => {
				this.log.error("Error starting server", err);
				reject(err);
			});
		});
	}

	protected async close() {
		await new Promise<void>((resolve, reject) => {
			this.server?.close((err) => {
				if (err) {
					this.log.error("Error closing server", err);
					reject(err);
				} else {
					this.log.info("Server closed");
					resolve();
				}
			});
		});
	}
}
