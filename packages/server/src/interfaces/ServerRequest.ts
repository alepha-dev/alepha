import type {
	IncomingMessage,
	ServerResponse as NodeServerResponse,
} from "node:http";
import type { Readable as NodeStream } from "node:stream";
import type { ReadableStream as NodeWebStream } from "node:stream/web";
import type {
	Async,
	Static,
	StreamLike,
	TArray,
	TFile,
	TObject,
	TRecord,
	TStream,
	TString,
	TVoid,
} from "@alepha/core";
import type { Route } from "@alepha/router";
import type { RouteMethod } from "../constants/routeMethods.ts";
import type { ServerReply } from "../helpers/ServerReply.ts";
import type { UserAgentInfo } from "../services/UserAgentParser.ts";

export type TRequestBody = TObject | TString | TArray | TRecord | TStream;
export type TResponseBody =
	| TObject
	| TString
	| TRecord
	| TFile
	| TArray
	| TStream
	| TVoid;

export interface RequestConfigSchema {
	body?: TRequestBody;
	params?: TObject;
	query?: TObject;
	headers?: TObject;
	response?: TResponseBody;
}

export interface ServerRequestConfig<
	TConfig extends RequestConfigSchema = RequestConfigSchema,
> {
	body: TConfig["body"] extends TRequestBody ? Static<TConfig["body"]> : any;

	headers: TConfig["headers"] extends TObject
		? Static<TConfig["headers"]>
		: Record<string, string>;

	params: TConfig["params"] extends TObject
		? Static<TConfig["params"]>
		: Record<string, string>;

	query: TConfig["query"] extends TObject
		? Static<TConfig["query"]>
		: Record<string, any>;
}

export type ServerRequestConfigEntry<
	TConfig extends RequestConfigSchema = RequestConfigSchema,
> = Partial<ServerRequestConfig<TConfig>>;

// ---------------------------------------------------------------------------------------------------------------------

export interface ServerRequest<
	TConfig extends RequestConfigSchema = RequestConfigSchema,
> extends ServerRequestConfig<TConfig> {
	method: RouteMethod;
	url: URL;
	requestId: string;

	/**
	 * Client IP address.
	 * Will parse `X-Forwarded-For` header if present.
	 */
	ip?: string;

	/**
	 * Value of the `Host` header sent by the client.
	 */
	host?: string;

	/**
	 * Browser user agent information.
	 * Information are not guaranteed to be accurate. Use with caution.
	 *
	 * @see {@link UserAgentParser}
	 */
	userAgent: UserAgentInfo;

	// store request data
	metadata: Record<string, any>;

	/**
	 * Reply object to be used to send response.
	 */
	reply: ServerReply;

	/**
	 * Raw request and response objects from platform.
	 * You should avoid using this property as much as possible to keep your code platform-agnostic.
	 */
	raw: {
		/**
		 * Node.js request and response objects.
		 */
		node?: {
			/**
			 * Node.js IncomingMessage object. (request)
			 */
			req: IncomingMessage;
			/**
			 * Node.js ServerResponse object. (response)
			 */
			res: NodeServerResponse;
		};
	};
}

// ---------------------------------------------------------------------------------------------------------------------

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
> = TConfig["response"] extends TResponseBody
	? Static<TConfig["response"]>
	: ResponseBodyType;

export type ResponseKind = "json" | "text" | "void" | "file" | "any";

export type ResponseBodyType =
	// not: object is not allowed, you want object ? add schema !
	string | Buffer | StreamLike | undefined | null | void;

export type ServerHandler<
	TConfig extends RequestConfigSchema = RequestConfigSchema,
> = (request: ServerRequest<TConfig>) => Async<ServerResponseBody<TConfig>>;

export interface ServerResponse {
	body: string | Buffer | ArrayBuffer | NodeStream | NodeWebStream;
	headers: Record<string, string>;
	status: number;
}

export type ServerRouteRequestHandler = (
	request: ServerRawRequest,
) => Promise<ServerResponse>;

export interface ServerRouteMatcher extends Route {
	handler: ServerRouteRequestHandler;
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
