import type {
	IncomingMessage,
	ServerResponse as NodeServerResponse,
} from "node:http";
import type { Readable as NodeStream } from "node:stream";
import type { ReadableStream as NodeWebStream } from "node:stream/web";
import type { Async, Static, StreamLike, TObject, TSchema } from "@alepha/core";
import type { Route } from "@alepha/router";
import type { RouteMethod } from "../constants/routeMethods.ts";
import type { ServerReply } from "../helpers/ServerReply.ts";

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
	ip?: string;

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
}

export interface ServerRoute<
	TConfig extends RequestConfigSchema = RequestConfigSchema,
> extends Route {
	handler: ServerHandler<TConfig>;
	method?: RouteMethod;
	schema?: TConfig;

	/**
	 * @see ServerLoggerProvider
	 */
	silent?: boolean;
}

// ---------------------------------------------------------------------------------------------------------------------

export type ServerResponseBody<
	TConfig extends RequestConfigSchema = RequestConfigSchema,
> = TConfig["response"] extends TSchema
	? Static<TConfig["response"]>
	: ResponseBodyType;

export type ResponseKind = "json" | "text" | "void" | "file" | "any";

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

export type ServerMiddlewareHandler<
	TConfig extends RequestConfigSchema = RequestConfigSchema,
> = (
	request: ServerRequest<TConfig>,
) => Async<ServerResponseBody<TConfig> | undefined>;

export interface ServerResponse {
	body: string | Buffer | ArrayBuffer | NodeStream | NodeWebStream;
	headers: Record<string, string>;
	status: number;
}

export interface ServerRouteMatcher extends Route {
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
