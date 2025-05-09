import type { IncomingMessage } from "node:http";
import type Stream from "node:stream";
import { createBrotliDecompress, createGunzip, createInflate } from "node:zlib";
import { $hook, $inject, Alepha, t } from "@alepha/core";
import { HttpError } from "../../errors/HttpError.ts";

const envSchema = t.object({
	SERVER_BODY_PARSER_INFLATE: t.boolean({
		default: true,
		description: "Enable decompression of request body.",
	}),
	SERVER_BODY_PARSER_LIMIT: t.uint({
		default: 100_000, // 100KB
		min: 0,
		description: "Maximum size of request body in bytes.",
	}),
});

export class ServerBodyParserProvider {
	protected readonly env = $inject(envSchema);
	protected readonly alepha = $inject(Alepha);

	public readonly onRequest = $hook({
		name: "server:onRequest",
		handler: async ({ route, request }) => {
			if (request.body) {
				return; // already parsed
			}

			const stream: Stream | undefined = request.raw.node?.req;
			if (!stream) {
				return; // not a node request - skip
			}

			if (route.schema?.body) {
				const body = await this.parse(stream, request.headers);
				if (body) {
					request.body = body;
				}
			}
		},
	});

	public async parse(
		stream: Stream,
		headers: Record<string, string>,
	): Promise<object | string | undefined> {
		const contentType = headers["content-type"];
		const contentEncoding = headers["content-encoding"];

		if (!contentType) return undefined;

		if (contentType.startsWith("application/json")) {
			return this.parseJson(stream, contentEncoding);
		}

		if (contentType.startsWith("text/plain")) {
			return this.parseText(stream, contentEncoding);
		}

		if (contentType.startsWith("application/x-www-form-urlencoded")) {
			return this.parseUrlEncoded(stream, contentEncoding);
		}

		return undefined;
	}

	public async parseText(
		stream: Stream,
		contentEncoding?: string,
	): Promise<string> {
		const buffer = await this.streamToBuffer(stream);
		const bufferInflated = await this.maybeDecompress(buffer, contentEncoding);
		try {
			return bufferInflated.toString("utf-8");
		} catch (error) {
			throw new HttpError(
				{
					status: 400,
					message: "Malformed text",
				},
				error,
			);
		}
	}

	public async parseUrlEncoded(
		stream: Stream,
		contentEncoding?: string,
	): Promise<object> {
		const text = await this.parseText(stream, contentEncoding);
		const params = new URLSearchParams(text);
		const result: Record<string, string> = {};
		for (const [key, value] of params.entries()) {
			result[key] = value;
		}

		return result;
	}

	public async parseJson(
		stream: Stream,
		contentEncoding?: string,
	): Promise<object> {
		try {
			const text = await this.parseText(stream, contentEncoding);
			return JSON.parse(text);
		} catch (error) {
			throw new HttpError(
				{
					status: 400,
					message: "Malformed JSON",
				},
				error,
			);
		}
	}

	protected async maybeDecompress(
		buffer: Buffer,
		encoding: string | undefined,
	): Promise<Buffer> {
		if (!this.env.SERVER_BODY_PARSER_INFLATE && encoding) {
			throw new HttpError({
				status: 415,
				message: `Content-Encoding ${encoding} not allowed`,
			});
		}

		switch (encoding) {
			case "gzip":
				return new Promise((res, rej) =>
					createGunzip()
						.end(buffer, () => {})
						.on("data", res)
						.on("error", rej),
				);
			case "deflate":
				return new Promise((res, rej) =>
					createInflate()
						.end(buffer, () => {})
						.on("data", res)
						.on("error", rej),
				);
			case "br":
				return new Promise((res, rej) =>
					createBrotliDecompress()
						.end(buffer, () => {})
						.on("data", res)
						.on("error", rej),
				);
			case undefined:
			case "identity":
				return buffer;
			default:
				throw new Error(`Unsupported Content-Encoding: ${encoding}`);
		}
	}

	protected streamToBuffer(req: Stream): Promise<Buffer> {
		const chunks: Buffer[] = [];
		let totalLength = 0;

		return new Promise((resolve, reject) => {
			req.on("data", (chunk) => {
				totalLength += chunk.length;

				if (totalLength > this.env.SERVER_BODY_PARSER_LIMIT) {
					(req as IncomingMessage).destroy(); // stop receiving data
					return reject(new Error("Body size limit exceeded"));
				}

				chunks.push(chunk);
			});

			req.on("end", () => {
				resolve(Buffer.concat(chunks));
			});

			req.on("error", (err) => {
				reject(err);
			});
		});
	}
}
