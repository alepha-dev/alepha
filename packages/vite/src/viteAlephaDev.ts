import path from "node:path";
import { pathToFileURL } from "node:url";
import type { Alepha, State } from "@alepha/core";
import {
	loadEnv,
	type Plugin,
	type ResolvedConfig,
	type ViteDevServer,
} from "vite";
import { getDefaultEntryFile } from "./helpers/getDefaultEntryFile.ts";

export interface ViteAlephaDevOptions {
	/**
	 * The entry point for the application. This is the file that will be executed when the application is run.
	 *
	 * @default 'src/index.server.ts'
	 */
	entry?: string;

	/**
	 * Enable or disable debug mode
	 *
	 * @default false
	 */
	debug?: boolean;
}

/**
 *
 */
export async function viteAlephaDev(
	options: ViteAlephaDevOptions = {},
): Promise<Plugin> {
	const entry = await getDefaultEntryFile(options.entry);
	const root = process.cwd().replace(/\\/g, "/");
	const state: {
		started: boolean;
		app?: Alepha;
		config?: ResolvedConfig;
		lock?: PromiseWithResolvers<void>;
	} = {
		started: false,
	};

	const ssr = () => {
		if (!state.app) return false;
		return state.app.state("ReactServerProvider.ssr" as keyof State) ?? false;
	};

	/**
	 *
	 */
	const log = (...msg: string[]) => {
		if (options.debug) {
			console.log(...msg);
		}
	};

	/**
	 *
	 */
	const start = async (server: ViteDevServer) => {
		if (state.started) {
			log("[DEBUG] Already started - skip starting");
			return;
		}

		if (!state.config) {
			log("[DEBUG] No config - skip starting");
			return;
		}

		log("[DEBUG] Starting Alepha app...");

		const env = loadEnv("development", state.config.root, "");
		for (const key in env) {
			process.env[key] = env[key];
		}

		process.env.NODE_ENV = "development";
		process.env.SSR = "true";
		process.env.SERVER = "true";
		process.env.VITE_ALEPHA_DEV = "true";
		process.env.SERVER_HOST =
			typeof server.config.server.host === "string"
				? server.config.server.host
				: "localhost";
		process.env.SERVER_PORT = String(server.config.server.port || "5173");

		state.started = false;

		const serverEntryPath = path.resolve(state.config.root, entry);
		const fileUrl = pathToFileURL(`${serverEntryPath}`).href;

		try {
			const imported = await server.ssrLoadModule(fileUrl);

			state.app = undefined;
			state.app = (globalThis as any).__alepha ?? imported.default;
			if (!state.app) {
				log("[DEBUG] No app found - skip starting");
				return;
			}

			await state.app.start();
			state.started = true;
			log("[DEBUG] Starting Done!");
		} catch (e) {
			console.error(e);
			log("[DEBUG] Alepha app start error");
		}
	};

	/**
	 *
	 */
	const stop = async () => {
		if (state.app?.stop && state.started) {
			log("[DEBUG] Stopping Alepha app...");
			await state.app.stop();
			state.started = false;
			log("[DEBUG] Stopping Done!");
		} else {
			log("[DEBUG] Alepha app not started - skip stop");
		}
	};

	/**
	 *
	 */
	const restart = async (server: ViteDevServer, invalidate?: boolean) => {
		if (state.lock) {
			return state.lock.promise;
		}

		state.lock = Promise.withResolvers();

		const now = Date.now();
		log("[DEBUG] RESTART");
		await stop();
		log(`[DEBUG] RESTART (stop) in ${Date.now() - now}ms`);

		if (invalidate) {
			server.moduleGraph.invalidateAll();
		}

		await start(server);
		log(`[DEBUG] RESTART OK in ${Date.now() - now}ms`);

		setTimeout(() => {
			state.lock?.resolve();
			state.lock = undefined;
		}, 250);
	};

	/**
	 *
	 */
	const isViteFile = (file: string) => {
		const [pathname] = file.split("?");

		// vite internal files
		if (
			pathname.startsWith("/@") ||
			pathname.startsWith("/src") ||
			pathname.includes("/node_modules/.vite/")
		) {
			return true;
		}

		// our backend files
		return false;
	};

	return {
		name: "alepha-dev",
		apply: "serve",

		/**
		 *
		 */
		configResolved(resolvedConfig) {
			state.config = resolvedConfig;
		},

		/**
		 *
		 */
		async handleHotUpdate(ctx) {
			log("[DEBUG] HMR", ctx.file);

			if (ctx.file.includes("/.idea/")) {
				return [];
			}

			const isServerOnly = !ctx.modules[0]?._clientModule;
			const isBrowserOnly = !ctx.modules[0]?._ssrModule;
			const isSsrEnabled = ssr();

			if (isBrowserOnly) {
				log("[DEBUG] HMR - browser only - no reason to reload server");
				return;
			}

			const invalidate = !ctx.file.startsWith(root);
			if (invalidate) {
				log("[DEBUG] HMR - outside root - invalidate all");
			}

			if (!isSsrEnabled && isServerOnly) {
				await restart(ctx.server, invalidate);
				return [];
			}

			if (isSsrEnabled && ctx.modules[0]) {
				await restart(ctx.server, invalidate);

				if (!state.started) {
					log("[DEBUG] HMR - abort due to app not started");
					return [];
				}

				if (isServerOnly && state.started) {
					ctx.server.ws.send({
						type: "custom",
						event: "alepha:reload",
						data: {},
					});
					return [];
				}
			}
		},

		/**
		 *
		 */
		async configureServer(server) {
			// forward vite request to alepha server
			server.middlewares.use((req, res, next) => {
				if (
					state.started &&
					state.app?.handle &&
					req.url &&
					!isViteFile(req.url)
				) {
					state.app.handle(req, res).then((status) => {
						if (!status) {
							next();
						}
					});
					return;
				}
				next();
			});

			server.config.logger.info = (msg: string) => {
				state.app?.log
					.child({
						caller: "Vite",
					})
					.info(msg.trim());
			};

			server.config.logger.clearScreen = () => {};

			await start(server);
		},

		/**
		 *
		 */
		async closeBundle() {
			log("[DEBUG] Closing bundle");
			if (state.app?.stop) {
				await state.app.stop();
			}
		},
	};
}
