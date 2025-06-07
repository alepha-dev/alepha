import { Readable } from "node:stream";
import { ReadableStream } from "node:stream/web";
import { promisify } from "node:util";
import * as zlib from "node:zlib";
import { $hook, $inject, t } from "@alepha/core";
import type { ServerResponse } from "../ServerRouterProvider.ts";

const gzip = promisify(zlib.gzip);
const createGzip = zlib.createGzip;
const brotli = promisify(zlib.brotliCompress);
const createBrotliCompress = zlib.createBrotliCompress;
const zstd = zlib.zstdCompress ? promisify(zlib.zstdCompress) : undefined;
const createZstdCompress = zstd ? zlib.createZstdCompress : undefined;

const envSchema = t.object({
	SERVER_COMPRESS_ENABLED: t.boolean({
		default: true,
		description: "Enable response compression.",
	}),
});

export class ServerCompressProvider {
	protected readonly env = $inject(envSchema);

	compressors = {
		gzip: {
			compress: gzip,
			stream: createGzip,
		},
		br: {
			compress: brotli,
			stream: createBrotliCompress,
		},
		zstd:
			zstd && createZstdCompress
				? {
						compress: zstd,
						stream: createZstdCompress,
					}
				: undefined,
	};

	params = {
		[zlib.constants.ZSTD_c_compressionLevel]: 3, // default compression level for zstd
	};

	public readonly onResponse = $hook({
		name: "server:onResponse",
		handler: async ({ request, response }) => {
			if (!this.env.SERVER_COMPRESS_ENABLED) {
				return;
			}

			// skip if already compressed
			if (response.headers["content-encoding"]) {
				return;
			}

			const acceptEncoding = request.headers["accept-encoding"]; // skip if no accept-encoding header
			if (!acceptEncoding) {
				return;
			}

			// skip if not json or html (for now)
			if (!this.isAllowedContentType(response.headers["content-type"])) {
				return;
			}

			for (const encoding of ["zstd", "br", "gzip"] as const) {
				if (acceptEncoding.includes(encoding) && this.compressors[encoding]) {
					await this.compress(encoding, response);
					return;
				}
			}
		},
	});

	protected isAllowedContentType(contentType: string | undefined): boolean {
		return (
			contentType === "application/json" ||
			contentType === "text/html" ||
			contentType === "application/javascript" ||
			contentType === "text/css"
		);
	}

	protected async compress(
		encoding: keyof typeof this.compressors,
		response: ServerResponse,
	) {
		const body = response.body; // can be string or Buffer or ArrayBuffer or Readable

		const compressor = this.compressors[encoding];
		if (!compressor) {
			return;
		}

		if (
			typeof body === "string" ||
			Buffer.isBuffer(body) ||
			body instanceof ArrayBuffer
		) {
			const compressed = await compressor.compress(body, {
				params: this.params,
			});
			this.setHeaders(response, encoding);
			response.headers["content-length"] = compressed.length.toString();
			response.body = compressed;
		}

		if (typeof body === "object" && body instanceof Readable) {
			this.setHeaders(response, encoding);
			response.body = body.pipe(compressor.stream({ params: this.params }));
		}

		if (typeof body === "object" && body instanceof ReadableStream) {
			this.setHeaders(response, encoding);
			response.body = Readable.fromWeb(body).pipe(
				compressor.stream({ params: this.params }),
			);
		}
	}

	protected setHeaders(
		response: ServerResponse,
		encoding: keyof typeof this.compressors,
	) {
		response.headers.vary = "content-encoding";
		response.headers["content-encoding"] = encoding;
		response.headers["cache-control"] = "no-cache";
	}
}
