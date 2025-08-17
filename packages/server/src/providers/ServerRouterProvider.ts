import { Readable as NodeStream } from "node:stream";
import { ReadableStream as NodeWebStream } from "node:stream/web";
import {
	$inject,
	Alepha,
	isFileLike,
	isTypeFile,
	TypeGuard,
} from "@alepha/core";
import { RouterProvider } from "@alepha/router";
import type { RouteMethod } from "../constants/routeMethods.ts";
import { errorNameByStatus, HttpError } from "../errors/HttpError.ts";
import { ValidationError } from "../errors/ValidationError.ts";
import { ServerReply } from "../helpers/ServerReply.ts";
import type {
	RequestConfigSchema,
	ResponseKind,
	ServerRawRequest,
	ServerRequest,
	ServerRequestConfig,
	ServerResponse,
	ServerRoute,
	ServerRouteMatcher,
} from "../interfaces/ServerRequest.ts";
import { ServerTimingProvider } from "./ServerTimingProvider.ts";

/**
 * Main router for all routes on the server side.
 *
 * - $route => generic route
 * - $action => action route (for API calls)
 * - $page => React route (for SSR)
 */
export class ServerRouterProvider extends RouterProvider<ServerRouteMatcher> {
	protected readonly alepha = $inject(Alepha);
	protected readonly routes: ServerRoute[] = [];
	protected readonly serverTimingProvider = $inject(ServerTimingProvider);

	public getRoutes(): ServerRoute[] {
		return this.routes;
	}

	public createRoute<TConfig extends RequestConfigSchema = RequestConfigSchema>(
		route: ServerRoute<TConfig>,
	): void {
		route.method ??= "GET";
		route.method = route.method.toUpperCase() as RouteMethod;

		this.routes.push(route);

		const path = `/${route.method}/${route.path}`.replace(/\/+/g, "/");
		const responseKind = this.getResponseType(route.schema);

		this.push({
			path,
			handler: (request) => this.onRequest(route, request, responseKind),
		});
	}

	public async onRequest(
		route: ServerRoute,
		rawRequest: ServerRawRequest,
		responseKind: ResponseKind,
	): Promise<ServerResponse> {
		// create request
		const request = {
			...rawRequest,
			body: null,
			metadata: {},
			reply: new ServerReply(),
			ip: this.getClientIp(rawRequest),
		} as ServerRequest;

		return await this.alepha.context.run(
			() => this.processRequest(request, route, responseKind),
			{
				context: rawRequest.headers["x-request-id"],
			},
		);
	}

	protected getClientIp(request: ServerRawRequest): string | undefined {
		// Check for the 'x-forwarded-for' header first, which is commonly used
		// in proxy setups to forward the original client's IP address.
		const forwardedFor = request.headers["x-forwarded-for"];
		if (forwardedFor) {
			// The 'x-forwarded-for' header can contain multiple IPs, so we take the first one.
			return Array.isArray(forwardedFor)
				? forwardedFor[0]
				: forwardedFor.split(",")[0].trim();
		}

		// If 'x-forwarded-for' is not present, fall back to the 'ip' property.
		if (request.raw.node?.req.socket?.remoteAddress) {
			return request.raw.node?.req.socket.remoteAddress;
		}
	}

	protected async processRequest(
		request: ServerRequest,
		route: ServerRoute,
		responseKind: ResponseKind,
	) {
		await this.runRouteHandler(route, request, responseKind).catch((error) =>
			this.errorHandler(route, request, error as Error),
		);

		await this.alepha.emit(
			"server:onSend",
			{
				request,
				route,
			},
			{
				catch: true, // avoid unhandled rejection
			},
		);

		// create response
		const response = {
			status: request.reply.status ?? (request.reply.body ? 200 : 204),
			headers: request.reply.headers,
			body: request.reply.body as any,
		};

		await this.alepha.emit(
			"server:onResponse",
			{
				request,
				route,
				response,
			},
			{
				catch: true, // avoid unhandled rejection
			},
		);

		return response;
	}

	protected async runRouteHandler(
		route: ServerRoute,
		request: ServerRequest,
		responseKind: ResponseKind,
	) {
		// there are some built-in hooks that are called before the request is handled
		// - ServerBodyParserProvider (parse body)
		// - ServerSecurityProvider (build user from headers)
		// - ServerLoggerProvider (log request)

		await this.alepha.emit(
			"server:onRequest", // this hook will fill request.user and request.cookies
			{
				request,
				route,
			},
			{
				log: false,
			},
		);

		if (
			request.reply.body ||
			(request.reply.status && request.reply.status >= 200)
		) {
			// if the body is already set, we can skip the handler
			// this is useful for middlewares that set the body
			return;
		}

		// request is ready to be used
		this.alepha.context.set<ServerRequest>("request", request as ServerRequest);

		// validate
		this.serverTimingProvider.beginTiming("validateRequest");
		this.validateRequest(route, request);
		this.serverTimingProvider.endTiming("validateRequest");

		// call the handler only if the body is not set yet
		this.serverTimingProvider.beginTiming("runHandler");
		try {
			const result = await route.handler(request);
			if (result) {
				request.reply.body = result;
			}
		} finally {
			this.serverTimingProvider.endTiming("runHandler");
		}

		this.serverTimingProvider.beginTiming("serializeResponse");
		this.serializeResponse(route, request.reply, responseKind);
		this.serverTimingProvider.endTiming("serializeResponse");
	}

	public serializeResponse(
		route: ServerRoute,
		reply: ServerReply,
		responseKind: ResponseKind,
	): void {
		if (responseKind === "json" && route.schema?.response) {
			reply.headers["content-type"] = "application/json";
			reply.body = JSON.stringify(
				this.alepha.parse<any>(route.schema.response, reply.body, {
					clone: true, // clone is required, as parse() will modify the object
				}),
			);
			return;
		}

		if (responseKind === "file") {
			if (!isFileLike(reply.body)) {
				throw new HttpError({
					status: 500,
					message: "Invalid response body - not a file",
				});
			}
			reply.headers["content-type"] = reply.body.type;
			reply.headers["content-disposition"] =
				`attachment; filename="${reply.body.name.replaceAll('"', "")}"`;
			reply.body = reply.body.stream() as NodeWebStream;
			return;
		}

		if (responseKind === "text") {
			reply.headers["content-type"] = "text/plain";
			reply.body = String(reply.body);
			return;
		}

		if (reply.body == null || responseKind === "void") {
			delete reply.headers["content-type"];
			reply.body = undefined;
			return;
		}

		if (Buffer.isBuffer(reply.body)) {
			reply.headers["content-type"] ??= "application/octet-stream";
			return;
		}

		if (
			reply.body instanceof NodeWebStream ||
			reply.body instanceof NodeStream
		) {
			// set content-type to application/octet-stream if not set
			reply.headers["content-type"] ??= "application/octet-stream";
			return;
		}

		reply.headers["content-type"] ??= "text/plain";
		reply.body = String(reply.body);
		return;
	}

	protected getResponseType(schema?: RequestConfigSchema): ResponseKind {
		if (schema?.response) {
			if (
				TypeGuard.IsObject(schema.response) ||
				TypeGuard.IsIntersect(schema.response) ||
				TypeGuard.IsRecord(schema.response) ||
				TypeGuard.IsArray(schema.response)
			) {
				return "json";
			}

			if (
				TypeGuard.IsString(schema.response) ||
				TypeGuard.IsInteger(schema.response) ||
				TypeGuard.IsNumber(schema.response) ||
				TypeGuard.IsBoolean(schema.response) ||
				TypeGuard.IsDate(schema.response)
			) {
				return "text";
			}

			if (isTypeFile(schema.response)) {
				return "file";
			}

			if (TypeGuard.IsVoid(schema.response)) {
				return "void";
			}
		}

		return "any";
	}

	protected async errorHandler(
		route: ServerRoute,
		request: ServerRequest,
		error: Error,
	) {
		if (error instanceof HttpError) {
			request.reply.status = error.status;
			request.reply.headers["content-type"] = "application/json";
			request.reply.body = JSON.stringify(HttpError.toJSON(error));
		} else {
			if (
				"status" in error &&
				typeof error.status === "number" &&
				!!errorNameByStatus[error.status]
			) {
				request.reply.status = error.status;
				request.reply.headers["content-type"] = "application/json";
				request.reply.body = JSON.stringify({
					status: error.status,
					error: errorNameByStatus[error.status],
					message: (error as Error).message,
				});
				return;
			}

			request.reply.status = 500;
			request.reply.headers["content-type"] = "application/json";
			request.reply.body = JSON.stringify({
				status: 500,
				error: "InternalServerError",
				message: (error as Error).message,
			});
		}

		await this.alepha.emit(
			"server:onError",
			{
				request,
				route,
				error,
			},
			{
				log: false,
			},
		);
	}

	public validateRequest(
		route: { schema?: RequestConfigSchema },
		request: ServerRequestConfig,
	) {
		if (route.schema?.params) {
			try {
				request.params = this.alepha.parse<any>(
					route.schema.params,
					request.params,
				);
			} catch (error) {
				throw new ValidationError("Invalid request params", error);
			}
		}

		if (route.schema?.query) {
			try {
				request.query = this.alepha.parse<any>(
					route.schema.query,
					request.query,
				);
			} catch (error) {
				throw new ValidationError("Invalid request query", error);
			}
		}

		if (route.schema?.headers) {
			try {
				request.headers = this.alepha.parse<any>(
					route.schema.headers,
					request.headers,
				);
			} catch (error) {
				throw new ValidationError("Invalid request header", error);
			}
		}

		if (route.schema?.body) {
			try {
				request.body = this.alepha.parse<any>(route.schema.body, request.body, {
					clone: false, // clone can be slow for big objects
					convert: false, // same
				});
			} catch (error) {
				throw new ValidationError("Invalid request body", error);
			}
		}
	}
}
