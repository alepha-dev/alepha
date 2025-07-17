import { createReadStream } from "node:fs";
import { access, readdir, stat } from "node:fs/promises";
import { basename, isAbsolute, join } from "node:path";
import type { Readable as NodeStream } from "node:stream";
import {
	$hook,
	$inject,
	$logger,
	Alepha,
	type Logger,
	OPTIONS,
} from "@alepha/core";
import { DateTimeProvider } from "@alepha/datetime";
import { getContentType } from "@alepha/file";
import { type ServerHandler, ServerRouterProvider } from "@alepha/server";
import { $serve, type ServeDescriptorOptions } from "../descriptors/$serve.ts";

export class ServerStaticProvider {
	protected readonly alepha = $inject(Alepha);
	protected readonly routerProvider: ServerRouterProvider =
		$inject(ServerRouterProvider);
	protected readonly dateTimeProvider: DateTimeProvider =
		$inject(DateTimeProvider);
	protected readonly log: Logger = $logger();

	protected readonly directories: ServeDirectory[] = [];

	protected readonly configure = $hook({
		on: "configure",
		handler: async () => {
			const serves = this.alepha.getDescriptorValues($serve);
			for (const { value, instance, key } of serves) {
				if (value[OPTIONS].disabled) {
					continue;
				}

				const name = value[OPTIONS].name ?? key;

				await this.serve(value[OPTIONS]);

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

	public async serve(options: ServeDescriptorOptions): Promise<void> {
		const prefix = options.path ?? "/";

		let root = options.root ?? process.cwd();
		if (!isAbsolute(root)) {
			root = join(process.cwd(), root);
		}

		this.log.debug("Serve static files", { prefix, root });
		const files = await this.getAllFiles(root, options.ignoreDotEnvFiles);

		const routes = await Promise.all(
			files.map(async (file) => {
				const path = file.replace(root, "").replace(/\\/g, "/");
				return {
					path: join(prefix, path).replace(/\\/g, "/"),
					handler: await this.createFileHandler(join(root, path), options),
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

		this.directories.push({
			options,
			files: files.map((file) => file.replace(root, "").replace(/\\/g, "/")),
		});

		if (options.historyApiFallback) {
			await this.routerProvider.route({
				path: join(prefix, "*").replace(/\\/g, "/"),
				handler: async (request) => {
					const { reply } = request;

					if (request.url.pathname.includes(".")) {
						// If the request is for a file (e.g., /style.css), do not fallback
						reply.headers["content-type"] = "text/plain";
						reply.body = "Not Found";
						reply.status = 404;
						return;
					}

					reply.headers["content-type"] = "text/html";
					reply.status = 200;

					// Serve index.html for all unmatched routes
					return createReadStream(join(root, "index.html"));
				},
			});
		}
	}

	public async createFileHandler(
		filepath: string,
		options: ServeDescriptorOptions,
	): Promise<ServerHandler> {
		const filename = basename(filepath);

		const hasGzip = await access(`${filepath}.gz`)
			.then(() => true)
			.catch(() => false);

		const hasBr = await access(`${filepath}.br`)
			.then(() => true)
			.catch(() => false);

		const fileStat = await stat(filepath);
		const lastModified = fileStat.mtime.toUTCString();
		const etag = `"${fileStat.size}-${fileStat.mtime.getTime()}"`;
		const contentType = getContentType(filename);
		const cacheControl = this.getCacheControl(filename, options);

		return async (request): Promise<NodeStream | undefined> => {
			const { headers, reply } = request;
			let path = filepath;

			const encoding = headers["accept-encoding"];
			if (encoding) {
				if (hasBr && encoding.includes("br")) {
					reply.headers["content-encoding"] = "br";
					path += ".br";
				} else if (hasGzip && encoding.includes("gzip")) {
					reply.headers["content-encoding"] = "gzip";
					path += ".gz";
				}
			}

			reply.headers["content-type"] = contentType;
			reply.headers["accept-ranges"] = "bytes";
			reply.headers["last-modified"] = lastModified;

			if (cacheControl) {
				reply.headers["cache-control"] =
					`public, max-age=${cacheControl.maxAge}`;
				if (cacheControl.immutable) {
					reply.headers["cache-control"] += ", immutable";
				}
			}

			reply.headers.etag = etag;
			if (
				headers["if-none-match"] === etag ||
				headers["if-modified-since"] === lastModified
			) {
				reply.status = 304;
				return;
			}

			return createReadStream(path);
		};
	}

	protected getCacheFileTypes(): string[] {
		return [".js", ".css"];
	}

	protected getCacheControl(
		filename: string,
		options: ServeDescriptorOptions,
	): { maxAge: number; immutable: boolean } | undefined {
		if (!options.cacheControl) {
			return;
		}

		const fileTypes =
			options.cacheControl.fileTypes ?? this.getCacheFileTypes();
		for (const type of fileTypes) {
			if (filename.endsWith(type)) {
				return {
					immutable: options.cacheControl.immutable ?? true,
					maxAge: this.dateTimeProvider
						.duration(options.cacheControl.maxAge ?? [2, "days"])
						.as("seconds"),
				};
			}
		}
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
