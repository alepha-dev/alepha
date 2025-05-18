import { randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { readFile, stat, unlink } from "node:fs/promises";
import type { IncomingMessage } from "node:http";
import { Readable } from "node:stream";
import { ReadableStream as NodeWebStream } from "node:stream/web";
import {
	$hook,
	$inject,
	Alepha,
	type FileLike,
	type StreamLike,
	TypeGuard,
	isTypeFile,
} from "@alepha/core";
import Busboy, {
	type BusboyConfig,
	type BusboyFileStream,
	type BusboyHeaders,
} from "@fastify/busboy";
import { HttpError } from "../../errors/HttpError.ts";
import { RouteDescriptorHelper } from "../../helpers/RouteDescriptorHelper.ts";
import type { ServerRoute } from "../ServerRouterProvider.ts";

export class ServerMultipartProvider {
	protected readonly helper = $inject(RouteDescriptorHelper);
	protected readonly alepha = $inject(Alepha);

	public readonly onRequest = $hook({
		name: "server:onRequest",
		handler: async ({ route, request }) => {
			if (request.body) {
				return; // already parsed
			}

			if (!route.schema?.body) {
				return;
			}

			const req: IncomingMessage | undefined = request.raw.node?.req;
			if (!req) {
				return; // not a node request - skip for now
			}

			const contentType = request.headers["content-type"];

			if (
				!this.helper.isMultipart(route) &&
				!contentType?.startsWith("multipart/form-data")
			) {
				return;
			}

			if (!contentType?.startsWith("multipart/form-data")) {
				throw new HttpError({
					status: 415,
					message: `Invalid content-type: ${contentType} - only "multipart/form-data" is accepted`,
				});
			}

			const { body, cleanup } = await this.handleMultipartBodyFromNode(
				route,
				req,
			);

			request.body = body;
			request.metadata.multipart = { cleanup };
		},
	});

	public readonly onSend = $hook({
		name: "server:onSend",
		handler: async ({ request }) => {
			const cleanup = request.metadata.multipart?.cleanup;
			if (typeof cleanup === "function") {
				await cleanup();
			}
		},
	});

	public async handleMultipartBodyFromNode(
		route: ServerRoute,
		stream: IncomingMessage,
	): Promise<{
		body: Record<string, any>;
		cleanup: () => Promise<void>;
	}> {
		let result: MultipartResult | undefined;

		try {
			result = await this.parseMultipart(stream, {});
		} catch (error) {
			throw new HttpError({
				status: 400,
				message: "Malformed multipart/form-data",
				cause: error,
			});
		}

		const body: any = {};

		for (const [key, value] of Object.entries(route.schema!.body!.properties)) {
			if (TypeGuard.IsSchema(value)) {
				if (isTypeFile(value)) {
					body[key] = result.files[key];
				} else {
					body[key] = this.alepha.parse(value, result.fields[key]);
				}
			}
		}

		return {
			body,
			cleanup: async () => {
				for (const file of Object.values(result.files)) {
					await file.cleanup();
				}
			},
		};
	}

	public async parseMultipart(
		req: IncomingMessage,
		config: Omit<BusboyConfig, "headers"> = {},
	): Promise<MultipartResult> {
		const parser = Busboy({
			headers: req.headers as BusboyHeaders,
			...config,
		});

		const fields: Record<string, string | string[]> = {};
		const files: Record<string, HybridFile> = {};
		const pending: Promise<void>[] = [];

		parser.on("field", (name, value) => {
			if (!fields[name]) {
				fields[name] = value;
				return;
			}

			if (Array.isArray(fields[name])) {
				(fields[name] as string[]).push(value);
				return;
			}

			fields[name] = [fields[name] as string, value];
		});

		parser.on(
			"file",
			(
				name: string,
				stream: BusboyFileStream,
				filename: string,
				_: string,
				mimeType: string,
			) => {
				const tmpPath = `${randomUUID()}`;
				const writer = createWriteStream(tmpPath);

				pending.push(
					new Promise<void>((resolve, reject) => {
						stream.pipe(writer);
						writer.on("finish", resolve);
						writer.on("error", reject);
					}),
				);

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
						return NodeWebStream.from(createReadStream(tmpPath));
					},
					async arrayBuffer() {
						return Buffer.from(await readFile(tmpPath)).buffer as ArrayBuffer;
					},
					text: async () => {
						return await readFile(tmpPath, "utf-8");
					},
					async cleanup() {
						if (this._state.cleanup) {
							return;
						}

						await unlink(tmpPath); // clean up the temp file
						this._state.cleanup = true;
					},
				};
			},
		);

		req.pipe(parser);

		await new Promise((resolve) => parser.on("finish", resolve));
		await Promise.all(pending);

		for (const file of Object.values(files)) {
			file._state.size = await stat(file._state.tmpPath).then(
				(stat) => stat.size,
			);
		}

		return { fields, files };
	}
}

interface MultipartResult {
	fields: Record<string, string | string[]>;
	files: Record<string, HybridFile>;
}

interface HybridFile extends FileLike {
	cleanup(): Promise<void>;
	_state: {
		cleanup: boolean;
		size: number;
		tmpPath: string;
	};
}

/**
 * Create a file-like object from various sources.
 */
export const file = (
	source: string | Buffer | ArrayBuffer | StreamLike,
	options: {
		type?: string;
		name?: string;
	} = {},
): FileLike => {
	if (source instanceof ReadableStream || source instanceof NodeWebStream) {
		return {
			name: options.name ?? "file",
			type: options.type ?? getContentType(options.name ?? "file"),
			size: 0,
			lastModified: Date.now(),
			stream: () => source,
			arrayBuffer: async () => {
				const reader = source.getReader();
				const { done, value } = await reader.read();
				if (done) {
					throw new Error("Stream is empty");
				}
				return value.buffer as ArrayBuffer;
			},
			text: async () => {
				const reader = source.getReader();
				const { done, value } = await reader.read();
				if (done) {
					throw new Error("Stream is empty");
				}
				return new TextDecoder().decode(value);
			},
		};
	}

	if (source instanceof Readable) {
		return {
			name: options.name ?? "file",
			type: options.type ?? getContentType(options.name ?? "file"),
			size: 0,
			lastModified: Date.now(),
			stream: () => NodeWebStream.from(source),
			arrayBuffer: async () => {
				const chunks: Buffer[] = [];
				for await (const chunk of source) {
					chunks.push(chunk);
				}
				return Buffer.concat(chunks).buffer as ArrayBuffer;
			},
			text: async () => {
				const chunks: Buffer[] = [];
				for await (const chunk of source) {
					chunks.push(chunk);
				}
				return Buffer.concat(chunks).toString("utf-8");
			},
		};
	}

	const name = options.name ?? "file";
	const buffer = Buffer.isBuffer(source)
		? source
		: typeof source === "string"
			? Buffer.from(source, "utf-8")
			: Buffer.from(source);
	return {
		name,
		type: options.type ?? getContentType(options.name ?? name),
		size: buffer.byteLength,
		lastModified: Date.now(),
		stream: () =>
			new ReadableStream({
				start(it) {
					it.enqueue(buffer);
					it.close();
				},
			}),
		arrayBuffer: async () => {
			return buffer.buffer as ArrayBuffer;
		},
		text: async () => {
			return buffer.toString("utf-8");
		},
	};
};

export const isFileLike = (value: any): value is FileLike => {
	return (
		!!value &&
		typeof value === "object" &&
		!Array.isArray(value) &&
		typeof value.name === "string" &&
		typeof value.type === "string" &&
		typeof value.size === "number" &&
		typeof value.stream === "function"
	);
};

export const getContentType = (filename: string): string => {
	if (filename.endsWith(".json")) {
		return "application/json";
	}
	if (filename.endsWith(".txt")) {
		return "text/plain";
	}
	if (filename.endsWith(".html")) {
		return "text/html";
	}
	if (filename.endsWith(".xml")) {
		return "application/xml";
	}
	if (filename.endsWith(".csv")) {
		return "text/csv";
	}
	if (filename.endsWith(".pdf")) {
		return "application/pdf";
	}
	if (filename.endsWith(".zip")) {
		return "application/zip";
	}
	if (filename.endsWith(".png")) {
		return "image/png";
	}
	if (filename.endsWith(".jpg") || filename.endsWith(".jpeg")) {
		return "image/jpeg";
	}
	if (filename.endsWith(".gif")) {
		return "image/gif";
	}
	return "application/octet-stream";
};
