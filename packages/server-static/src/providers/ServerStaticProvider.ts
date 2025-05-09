import { createReadStream } from "node:fs";
import { readdir } from "node:fs/promises";
import { basename, isAbsolute, join } from "node:path";
import type { Readable as NodeStream } from "node:stream";
import { $hook, $inject, $logger, Alepha } from "@alepha/core";
import { type ServerHandler, ServerRouterProvider } from "@alepha/server";
import mime from "mime";
import { $serve, type ServeDescriptorOptions } from "../descriptors/$serve.ts";

export class ServerStaticProvider {
	protected readonly alepha = $inject(Alepha);
	protected readonly routerProvider = $inject(ServerRouterProvider);
	protected readonly log = $logger();

	protected readonly directories: ServeDirectory[] = [];

	protected readonly configure = $hook({
		name: "configure",
		handler: async () => {
			const serves = this.alepha.getDescriptorValues($serve);
			for (const { value, instance, key } of serves) {
				if (value.options.disabled) {
					continue;
				}

				const name = value.options.name ?? key;

				await this.serve(value.options);

				instance[key].list = () => {
					return this.list(name);
				};
			}
		},
	});

	public list(name: string): string[] {
		const directory = this.directories.find((dir) => dir.options.name === name);
		if (!directory) {
			return [];
		}

		return directory.files;
	}

	public async serve(options: ServeDescriptorOptions) {
		const prefix = options.path ?? "/";

		let root = options.root ?? process.cwd();
		if (!isAbsolute(root)) {
			root = join(process.cwd(), root);
		}

		this.log.info("Serve static files", { prefix, root });
		const files = await this.getAllFiles(root, options.ignoreDotEnvFiles);

		const routes = await Promise.all(
			files.map(async (file) => {
				const path = file.replace(root, "").replace(/\\/g, "/");
				return {
					path: join(prefix, path).replace(/\\/g, "/"),
					handler: await this.createFileHandler(root, path),
				};
			}),
		);

		for (const route of routes) {
			await this.routerProvider.route(route);

			if (
				options.indexFallback !== false &&
				route.path.endsWith("index.html")
			) {
				await this.routerProvider.route({
					path: route.path.replace(/index\.html$/, ""),
					handler: route.handler,
				});
			}
		}

		// redirect to trailing slash (e.g. /dist -> /dist/)
		if (!prefix.endsWith("/")) {
			await this.routerProvider.route({
				path: prefix,
				handler: ({ reply }) => reply.redirect(`${prefix}/`),
			});
		}

		this.directories.push({
			options,
			files: files.map((file) => file.replace(root, "").replace(/\\/g, "/")),
		});
	}

	public async createFileHandler(
		root: string,
		file: string,
	): Promise<ServerHandler> {
		// TODO: check if file.gz exists and serve it when header "accept-encoding" contains "gzip"
		// TODO: same for file.br
		return async ({ reply }): Promise<NodeStream> => {
			const filepath = join(root, file);
			const filename = basename(filepath);
			const stream = createReadStream(filepath);

			reply.headers["content-type"] =
				mime.getType(filename) ?? "application/octet-stream";
			reply.headers["accept-ranges"] = "bytes";
			reply.headers["content-encoding"] = "identity";

			// TODO: cache-control
			// TODO: etag
			// TODO: last-modified
			// TODO: content-length

			return stream;
		};
	}

	public async getAllFiles(
		dir: string,
		ignoreDotEnvFiles = true,
	): Promise<string[]> {
		const entries = await readdir(dir, { withFileTypes: true });
		const files = await Promise.all(
			entries.map((dirent) => {
				// skip .env & other dot files
				if (ignoreDotEnvFiles && dirent.name.startsWith(".")) {
					return [];
				}

				const fullPath = join(dir, dirent.name);
				return dirent.isDirectory() ? this.getAllFiles(fullPath) : fullPath;
			}),
		);

		return files.flat();
	}
}

export interface ServeDirectory {
	options: ServeDescriptorOptions;
	files: string[];
}
