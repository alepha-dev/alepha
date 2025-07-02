import { randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { readFile, stat, unlink } from "node:fs/promises";
import type { IncomingMessage } from "node:http";
import * as os from "node:os";
import {
	$hook,
	$inject,
	Alepha,
	type FileLike,
	isTypeFile,
	TypeGuard,
} from "@alepha/core";
import { bufferToArrayBuffer } from "@alepha/file";
import Busboy, {
	type BusboyConfig,
	type BusboyFileStream,
	type BusboyHeaders,
} from "@fastify/busboy";
import { HttpError } from "../../errors/HttpError.ts";
import { ActionDescriptorHelper } from "../../helpers/ActionDescriptorHelper.ts";
import type { ServerRoute } from "../../interfaces/index.ts";

export class ServerMultipartProvider {
	protected readonly helper = $inject(ActionDescriptorHelper);
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
		name: "server:onResponse",
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
				const tmpPath = `${os.tmpdir()}/${randomUUID()}`;
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
					filepath: tmpPath,
					get size() {
						return this._state.size;
					},
					stream() {
						return createReadStream(tmpPath);
					},
					async arrayBuffer() {
						const content = await readFile(tmpPath);
						return bufferToArrayBuffer(content);
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
