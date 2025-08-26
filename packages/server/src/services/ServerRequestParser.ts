import { $inject, Alepha } from "@alepha/core";
import { ServerReply } from "../helpers/ServerReply.ts";
import type {
	ServerRawRequest,
	ServerRequest,
} from "../interfaces/ServerRequest.ts";
import { UserAgentParser } from "./UserAgentParser.ts";

export class ServerRequestParser {
	protected readonly alepha = $inject(Alepha);
	protected readonly userAgentParser = $inject(UserAgentParser);

	public createServerRequest(rawRequest: ServerRawRequest): ServerRequest {
		const self = this;
		return {
			method: rawRequest.method,
			url: rawRequest.url,
			raw: rawRequest.raw,
			headers: rawRequest.headers,
			query: rawRequest.query,
			params: rawRequest.params,
			// body will be filled by body parser middleware
			body: null,
			metadata: {},
			reply: this.alepha.inject(ServerReply, { lifetime: "transient" }),
			get ip() {
				return self.getRequestIp(rawRequest);
			},
			get userAgent() {
				return self.getRequestUserAgent(rawRequest);
			},
		} as ServerRequest;
	}

	public getRequestId(request: ServerRawRequest): string | undefined {
		return request.headers["x-request-id"];
	}

	public getRequestUserAgent(request: ServerRawRequest) {
		return this.userAgentParser.parse(request.headers["user-agent"]);
	}

	public getRequestIp(request: ServerRawRequest): string | undefined {
		// check for the 'x-forwarded-for' header first, which is commonly used
		// in proxy setups to forward the original client's IP address.

		// https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/X-Forwarded-For

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
}
