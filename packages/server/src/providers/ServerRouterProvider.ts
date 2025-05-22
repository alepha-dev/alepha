import type {
	IncomingMessage,
	ServerResponse as NodeServerResponse,
} from "node:http";
import { Readable as NodeStream } from "node:stream";
import { ReadableStream as NodeWebStream } from "node:stream/web";
import {
	$inject,
	Alepha,
	type Async,
	type Static,
	type StreamLike,
	type TSchema,
	TypeGuard,
	isFileLike,
	isTypeFile,
	t,
} from "@alepha/core";
import type { TObject } from "@alepha/core";
import { type Route, RouterProvider } from "@alepha/router";
import type { UserAccountToken } from "@alepha/security";
import type { RouteMethod } from "../constants/routeMethods.ts";
import { HttpError, errorNameByStatus } from "../errors/HttpError.ts";
import { ValidationError } from "../errors/ValidationError.ts";

const envSchema = t.object({
	SERVER_ALS_ENABLED: t.boolean({
		default: true,
		description:
			"Enable ALS (Async Local Storage) for request context. Disable for performance.",
	}),
});

declare module "@alepha/core" {
	interface Env extends Partial<Static<typeof envSchema>> {}
}

// Router used in Server (action, proxy, ssr, etc...)
export class ServerRouterProvider extends RouterProvider<ServerRouteWithHandler> {
	protected readonly alepha = $inject(Alepha);
	protected readonly env = $inject(envSchema);

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
			handler: (request) =>
				this.handle(route, request, responseType, this.env.SERVER_ALS_ENABLED),
		});
	}

	public async handle(
		route: ServerRoute,
		rawRequest: ServerRawRequest,
		responseType: ResponseType,
		withAls: boolean,
	): Promise<ServerResponse> {
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

		if (!withAls) {
			return this.processRequest(request, route, responseType, withAls);
		}

		const requestId = this.createRequestId();

		return await this.alepha.als.run(
			{
				context: requestId, // for logging
			},
			() => this.processRequest(request, route, responseType, withAls),
		);
	}

	protected async processRequest(
		request: ServerRequest,
		route: ServerRoute,
		responseType: ResponseType,
		withAls: boolean,
	) {
		await this.tryRequestProcessing(
			route,
			request,
			responseType,
			withAls,
		).catch((error) => this.errorHandler(route, request, error as Error));

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

	protected async tryRequestProcessing(
		route: ServerRoute,
		request: ServerRequest,
		responseType: ResponseType,
		withAls: boolean,
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

		// validate
		this.validateRequest(route, request);

		// request is ready to be used
		if (withAls) {
			this.alepha.als.set<ServerRequest>("request", request as ServerRequest);
		}

		// call the handler
		const result = await route.handler(request);
		if (result) {
			request.reply.body = result;
		}

		this.serializeResponse(route, request.reply, responseType);
	}

	protected getResponseType(schema?: RequestConfigSchema): ResponseType {
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

	public serializeResponse(
		route: ServerRoute,
		reply: ServerReply,
		responseType: ResponseType,
	): void {
		if (responseType === "json" && route.schema?.response) {
			reply.headers["content-type"] = "application/json";
			reply.body = JSON.stringify(
				this.alepha.parse<any>(route.schema.response, reply.body, {
					clone: true, // clone is required, as parse() will modify the object
				}),
			);
			return;
		}

		if (responseType === "file") {
			if (!isFileLike(reply.body)) {
				throw new HttpError({
					status: 500,
					message: "Invalid response body - not a file",
				});
			}
			reply.headers["content-type"] = reply.body.type;
			reply.headers["content-disposition"] =
				`attachment; filename="${reply.body.name}"`;
			reply.body = reply.body.stream() as NodeWebStream;
			return;
		}

		if (responseType === "text") {
			reply.headers["content-type"] = "text/plain";
			reply.body = String(reply.body);
			return;
		}

		if (reply.body == null || responseType === "void") {
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
}

// ---------------------------------------------------------------------------------------------------------------------

export interface RequestConfigSchema {
	body?: TSchema;
	params?: TObject;
	query?: TObject;
	headers?: TObject;
	response?: TSchema;
}

export interface ServerRequestConfig<
	TConfig extends RequestConfigSchema = RequestConfigSchema,
> {
	body: TConfig["body"] extends TSchema ? Static<TConfig["body"]> : any;

	headers: TConfig["headers"] extends TObject
		? Static<TConfig["headers"]>
		: Record<string, string>;

	params: TConfig["params"] extends TObject
		? Static<TConfig["params"]>
		: Record<string, string>;

	query: TConfig["query"] extends TObject
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
	user: UserAccountToken;
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

export type ResponseType = "json" | "text" | "void" | "file" | "any";

export type ResponseBodyType =
	| string
	| Buffer
	| StreamLike
	| undefined
	| null
	| void;

export type ServerHandler<
	TConfig extends RequestConfigSchema = RequestConfigSchema,
> = (request: ServerRequest<TConfig>) => Async<ServerResponseBody<TConfig>>;

export interface ServerReply {
	headers: Record<string, string> & { "set-cookie"?: string[] };
	status?: number; // default 200, or 204 (no content)
	body?: any;
	redirect(url: string): void;
}

export interface ServerResponse {
	body: string | ArrayBuffer | NodeStream | NodeWebStream;
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
