import { promisify } from "node:util";
import { brotliCompress as brotliCb, gzip as gzipCb } from "node:zlib";
import { $hook, $inject, t } from "@alepha/core";
import type { ServerResponse } from "../ServerRouterProvider.ts";

const gzip = promisify(gzipCb);
const brotli = promisify(brotliCb);

const envSchema = t.object({
	SERVER_COMPRESS_ENABLED: t.boolean({
		default: true,
		description: "Enable response compression.",
	}),
});

export class ServerCompressProvider {
	protected readonly env = $inject(envSchema);

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
			if (
				response.headers["content-type"] !== "application/json" &&
				response.headers["content-type"] !== "text/html"
			) {
				return;
			}

			// only compress strings for now
			if (typeof response.body !== "string") {
				return;
			}

			// TODO: check Node version before using zstd
			// if (acceptEncoding.includes("zstd") && zstd) {
			// 	const compressed = await zstd(response.body);
			// 	this.format("zstd", response, compressed);
			// 	return;
			// }

			if (acceptEncoding.includes("br")) {
				const compressed = await brotli(response.body);
				this.format("br", response, compressed);
				return;
			}

			if (acceptEncoding.includes("gzip")) {
				const compressed = await gzip(response.body);
				this.format("gzip", response, compressed);
				return;
			}
		},
	});

	protected format(
		encoding: string,
		response: ServerResponse,
		compressed: Buffer,
	) {
		response.headers["content-encoding"] = encoding;
		response.headers["content-length"] = compressed.length.toString();
		response.headers.vary = "content-encoding";
		response.headers["cache-control"] = "no-cache";
		response.body = compressed as any;
	}
}
