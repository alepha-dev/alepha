import type { Alepha } from "@alepha/core";
import type { UserConfig, ViteDevServer } from "vite";
import { importVite } from "./importVite.ts";

export const importAlepha = async (
	entry: string,
	options: {
		config: UserConfig;
		env: Record<string, string>;
	},
): Promise<{
	alepha: Alepha;
	server?: ViteDevServer;
}> => {
	const { loadEnv, createServer } = await importVite();

	const server = await createServer({
		server: { middlewareMode: true },
		appType: "custom",
		...options.config,
	});

	await server.pluginContainer.buildStart({});

	const env = loadEnv("development", process.cwd(), "");

	if (global.__alepha) {
		const alepha = global.__alepha as Alepha;
		return { alepha };
	}

	for (const key in env) {
		process.env[key] = env[key];
	}

	for (const key in options.env) {
		process.env[key] = options.env[key];
	}

	process.env.VITE_ALEPHA_DEV = "true";
	process.env.LOG_LEVEL = "error";
	process.env.LOG_FORMAT = "text";
	process.env.NODE_ENV = "production";

	await server.ssrLoadModule(entry);

	const alepha = global.__alepha as Alepha | undefined;
	if (!alepha) {
		throw new Error("Alepha instance not found. Ensure Alepha is initialized.");
	}

	await alepha.emit("configure", alepha);

	return { alepha, server };
};
