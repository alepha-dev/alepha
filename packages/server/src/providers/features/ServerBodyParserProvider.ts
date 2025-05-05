import { randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { readFile, stat, unlink } from "node:fs/promises";
import type { IncomingMessage } from "node:http";
import { ReadableStream } from "node:stream/web";
import { TextDecoder } from "node:util";
import { createBrotliDecompress, createGunzip, createInflate } from "node:zlib";
import { $hook, $inject, Alepha, TypeGuard, isTypeFile, t } from "@alepha/core";
import Busboy, {
	type BusboyFileStream,
	type BusboyHeaders,
} from "@fastify/busboy";
import { HttpError } from "../../errors/HttpError.ts";
import { RouteDescriptorHelper } from "../../helpers/RouteDescriptorHelper.ts";
import type { ServerRequest, ServerRoute } from "../ServerRouterProvider.ts";

const envSchema = t.object({
	SERVER_BODY_PARSER_INFLATE: t.boolean({
		default: true,
		description: "Enable decompression of request body.",
	}),
	SERVER_BODY_PARSER_LIMIT: t.uint({
		default: 100_000,
		min: 0,
		description: "Maximum size of request body in bytes.",
	}),
});

export class ServerBodyParserProvider {
	protected readonly env = $inject(envSchema);
	protected readonly helper = $inject(RouteDescriptorHelper);
	protected readonly alepha = $inject(Alepha);

	public readonly onRequest = $hook({
		name: "server:onRequest",
		handler: async ({ route, request }) => {
			if (!(request.body instanceof ReadableStream)) {
				return; // empty body or already parsed
			}

			if (route.schema?.body) {
				const body = await this.parse(request.body, request.headers);
				if (body) {
					request.body = body;
					return;
				}
			}

			// multipart/form-data is Node.js only for now
			if (!this.helper.isMultipart(route)) {
				return;
			}

			const contentType = request.headers["content-type"];

			if (!contentType?.startsWith("multipart/form-data")) {
				throw new HttpError({
					status: 415,
					message: `Invalid content-type: ${contentType} - only "multipart/form-data" is accepted`,
				});
			}

			const cleanup = await this.handleMultipartBody(route, request);

			request.metadata.multipart = { cleanup };
		},
	});

	protected readonly onSend = $hook({
		name: "server:onSend",
		handler: async ({ request }) => {
			const cleanup = request.metadata.multipart?.cleanup;
			if (typeof cleanup === "function") {
				await cleanup();
			}
		},
	});

	public async parseText(
		stream: ReadableStream,
		contentEncoding?: string,
	): Promise<string> {
		const buffer = await this.streamToBuffer(stream);
		const bufferInflated = await this.maybeDecompress(buffer, contentEncoding);
		try {
			return new TextDecoder().decode(bufferInflated);
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
		stream: ReadableStream,
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

	public async parse(
		stream: ReadableStream,
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

	public async handleMultipartBody(
		route: ServerRoute,
		request: ServerRequest,
	): Promise<any> {
		const req = request.raw.node?.req;
		if (!req) {
			return;
		}

		const result = await this.parseMultipart(req);
		const body: any = {};

		if (!route.schema?.body) {
			return;
		}

		for (const [key, value] of Object.entries(route.schema.body.properties)) {
			if (TypeGuard.IsSchema(value)) {
				if (isTypeFile(value)) {
					body[key] = result.files[key];
				} else {
					body[key] = this.alepha.parse(value, result.fields[key]);
				}
			}
		}

		request.body = body;

		return async () => {
			for (const file of Object.values(result.files)) {
				await file.cleanup();
			}
		};
	}

	public async parseMultipart(req: IncomingMessage): Promise<MultipartResult> {
		const contentType = req.headers["content-type"];
		if (!contentType?.startsWith("multipart/form-data")) {
			throw new Error(`Unsupported content-type: ${contentType}`);
		}

		const busboy = Busboy({ headers: req.headers as BusboyHeaders });
		const fields: Record<string, string | string[]> = {};
		const files: Record<string, HybridFile> = {};

		const fileWrites: Promise<void>[] = [];

		busboy.on("field", (name, value) => {
			if (fields[name]) {
				if (Array.isArray(fields[name])) {
					(fields[name] as string[]).push(value);
				} else {
					fields[name] = [fields[name] as string, value];
				}
			} else {
				fields[name] = value;
			}
		});

		busboy.on(
			"file",
			(
				name: string,
				stream: BusboyFileStream,
				filename: string,
				_transferEncoding: string,
				mimeType: string,
			) => {
				const tmpPath = randomUUID();
				const writeStream = createWriteStream(tmpPath);
				const writeDone = new Promise<void>((resolve, reject) => {
					stream.pipe(writeStream);
					writeStream.on("finish", resolve);
					writeStream.on("error", reject);
				});

				fileWrites.push(writeDone);

				files[name] = {
					_state: {
						cleanup: false,
						size: 0,
						tmpPath,
					},
					name: filename,
					type: mimeType,
					lastModified: Date.now(),
					get size() {
						return this._state.size;
					},
					stream() {
						return ReadableStream.from(createReadStream(tmpPath));
					},
					async arrayBuffer() {
						const buffer = await readFile(tmpPath);
						await this.cleanup();
						return buffer;
					},
					async cleanup() {
						if (this._state.cleanup) {
							return;
						}
						await unlink(tmpPath); // Clean up the temp file
						this._state.cleanup = true;
					},
				};
			},
		);

		req.pipe(busboy);

		await new Promise<void>((resolve) => busboy.on("finish", resolve));
		await Promise.all(fileWrites);
		for (const file of Object.values(files)) {
			file._state.size = await stat(file._state.tmpPath).then(
				(stat) => stat.size,
			);
		}

		return { fields, files };
	}

	protected async streamToBuffer(stream: ReadableStream): Promise<Buffer> {
		const reader = stream.getReader();
		const chunks: Uint8Array[] = [];
		let totalLength = 0;

		while (true) {
			const { done, value } = await reader.read();
			if (done) break;

			totalLength += value.byteLength;
			if (totalLength > this.env.SERVER_BODY_PARSER_LIMIT) {
				throw new HttpError({ status: 413, message: "Body exceeds limit" });
			}

			chunks.push(value);
		}

		return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
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

	public async parseJson(
		stream: ReadableStream,
		contentEncoding?: string,
	): Promise<object> {
		try {
			return JSON.parse(await this.parseText(stream, contentEncoding));
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
}

interface MultipartResult {
	fields: Record<string, string | string[]>;
	files: Record<string, HybridFile>;
}

interface HybridFile {
	name: string;
	type: string;
	size: number;
	lastModified: number;
	stream(): ReadableStream<Uint8Array>;
	arrayBuffer(): Promise<Uint8Array>;
	cleanup(): Promise<void>;
	_state: {
		cleanup: boolean;
		size: number;
		tmpPath: string;
	};
}
