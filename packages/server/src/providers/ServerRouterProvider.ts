import type {
	IncomingMessage,
	ServerResponse as NodeServerResponse,
} from "node:http";
import type { Readable as NodeStream } from "node:stream";
import type { ReadableStream as WebStream } from "node:stream/web";
import {
	$inject,
	Alepha,
	type Async,
	type Static,
	type TSchema,
	TypeGuard,
	isTypeFile,
} from "@alepha/core";
import { type Route, RouterProvider } from "@alepha/router";
import type { UserAccountToken } from "@alepha/security";
import type { RouteMethod } from "../constants/routeMethods.ts";
import { HttpError, errorNameByStatus } from "../errors/HttpError.ts";
import { ValidationError } from "../errors/ValidationError.ts";
import { isFileLike } from "./features/ServerMultipartProvider.ts";

// Router used in Server (action, proxy, ssr, etc...)
export class ServerRouterProvider extends RouterProvider<ServerRouteWithHandler> {
	protected readonly alepha = $inject(Alepha);

	public createRequestId() {
		return Math.random().toString(36).substring(2, 15);
	}

	public async route<TConfig extends RequestConfigSchema = RequestConfigSchema>(
		route: ServerRoute<TConfig>,
	) {
		const method = (route.method ?? "GET").toUpperCase();
		const path = `/${method}/${route.path}`.replace(/\/+/g, "/");
		const responseType = this.getResponseType(route.schema);

		await this.alepha.emit(
			"server:onRoute",
			{
				route,
			},
			{
				log: false,
			},
		);

		return this.push({
			path,
			handler: (request) => this.handle(route, request, responseType),
		});
	}

	public async handle(
		route: ServerRoute,
		rawRequest: ServerRawRequest,
		responseType: ResponseType,
	): Promise<ServerResponse> {
		const requestId = this.createRequestId();

		return await this.alepha.als.run(
			{
				context: requestId, // for logging
			},
			async () => {
				// create request
				const request = {
					...rawRequest,
					body: null,
					metadata: {},
					reply: {
						headers: {},
						redirect: (url: string) => {
							request.reply.status = 302;
							request.reply.headers.location = url;
						},
					},
				} as ServerRequest;

				try {
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

					// validate
					this.validateRequest(route, request);

					// request is ready to be used
					this.alepha.als.set<ServerRequest>(
						"request",
						request as ServerRequest,
					);

					// call the handler
					const result = await route.handler(request);
					if (result) {
						request.reply.body = result;
					}

					this.serializeResponse(route, request.reply, responseType);
				} catch (error) {
					await this.errorHandler(route, request, error as Error);
				}

				await this.alepha.emit(
					"server:onSend",
					{
						request,
						route,
					},
					{
						log: false,
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
						log: false,
					},
				);

				return response;
			},
		);
	}

	protected getResponseType(schema?: RequestConfigSchema): ResponseType {
		if (!schema?.response) {
			return "buffer";
		}

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

		return "buffer";
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

	public serializeResponse(
		route: ServerRoute,
		reply: ServerReply,
		responseType: ResponseType,
	): void {
		// TODO: hook preSerialize ?

		if (!route.schema?.response) {
			return;
		}

		if (responseType === "json") {
			reply.headers["content-type"] = "application/json";
			reply.body = JSON.stringify(
				this.alepha.parse<any>(route.schema.response, reply.body),
			);
			return;
		}

		if (responseType === "buffer") {
			reply.headers["content-type"] = "application/octet-stream";
			return;
		}

		if (responseType === "file") {
			if (isFileLike(reply.body)) {
				reply.headers["content-type"] = reply.body.type;
				reply.headers["content-disposition"] =
					`attachment; filename="${reply.body.name}"`;
				reply.body = reply.body.stream() as WebStream;
				return;
			}

			reply.headers["content-type"] = "application/octet-stream";
			return;
		}

		if (responseType === "text") {
			reply.headers["content-type"] = "text/plain";
			reply.body = String(reply.body);
			return;
		}

		if (responseType === "void") {
			delete reply.headers["content-type"];
			reply.body = undefined;
			return;
		}
	}
}

// ---------------------------------------------------------------------------------------------------------------------

export interface RequestConfigSchema {
	body?: TSchema;
	params?: TSchema;
	query?: TSchema;
	headers?: TSchema;
	response?: TSchema;
}

export interface ServerRequestConfig<
	TConfig extends RequestConfigSchema = RequestConfigSchema,
> {
	body: TConfig["body"] extends TSchema ? Static<TConfig["body"]> : any;

	headers: TConfig["headers"] extends TSchema
		? Static<TConfig["headers"]>
		: Record<string, string>;

	params: TConfig["params"] extends TSchema
		? Static<TConfig["params"]>
		: Record<string, string>;

	query: TConfig["query"] extends TSchema
		? Static<TConfig["query"]>
		: Record<string, string>;
}

export type ServerRequestConfigEntry<
	TConfig extends RequestConfigSchema = RequestConfigSchema,
> = Partial<ServerRequestConfig<TConfig>>;

export interface ServerRequest<
	TConfig extends RequestConfigSchema = RequestConfigSchema,
> extends ServerRequestConfig<TConfig> {
	method: RouteMethod;
	url: URL;

	// store request data
	metadata: Record<string, any>;

	// sugar methods
	reply: ServerReply;

	// forward raw request
	raw: {
		node?: {
			req: IncomingMessage;
			res: NodeServerResponse;
		};
	};

	// user from SecurityModule
	user?: UserAccountToken;
}

export interface ServerRoute<
	TConfig extends RequestConfigSchema = RequestConfigSchema,
> extends Route {
	method?: RouteMethod; // undefined = all
	silent?: boolean;
	handler: ServerHandler<TConfig>;
	schema?: TConfig;
}

export type ServerResponseBody<
	TConfig extends RequestConfigSchema = RequestConfigSchema,
> = TConfig["response"] extends TSchema
	? Static<TConfig["response"]>
	: ResponseBodyType;

export type ResponseType =
	| "json"
	| "text"
	| "void"
	| "stream"
	| "buffer"
	| "file";

export type ResponseBodyType =
	| string
	| ArrayBuffer //
	| NodeStream // Node stream Readable (stream)
	| WebStream // Web stream Readable (stream)
	| ReadableStream // Web stream Readable (stream)
	| undefined // undefined response (no response)
	| null // null response (no response)
	| void; // void response (no response)

export type ServerHandler<
	TConfig extends RequestConfigSchema = RequestConfigSchema,
> = (request: ServerRequest<TConfig>) => Async<ServerResponseBody<TConfig>>;

export interface ServerReply {
	headers: Record<string, string> & { "set-cookie"?: string[] };
	status?: number; // default 200, or 204 (no content)
	body?: ResponseBodyType;

	redirect(url: string): void;
}

export interface ServerResponse {
	body: string | ArrayBuffer | NodeStream | WebStream;
	headers: Record<string, string>;
	status: number;
}

export interface ServerRouteWithHandler extends Route {
	handler: (request: ServerRawRequest) => Promise<ServerResponse>;
}

export interface ServerRawRequest {
	method: RouteMethod;
	url: URL;
	headers: Record<string, string>;
	query: Record<string, string>;
	params: Record<string, string>;
	raw: {
		node?: {
			req: IncomingMessage;
			res: NodeServerResponse;
		};
	};
}
