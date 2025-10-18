import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { type Alepha, AlephaError } from "@alepha/core";
import { importVite } from "./importVite.ts";

/**
 * Import Alepha instance from a transpiled server entry file.
 */
export const importAlepha = async (
	entry: string,
	options: {
		env: Record<string, string>;
	},
): Promise<Alepha> => {
	if (global.__alepha) {
		return global.__alepha as Alepha;
	}

	const { loadEnv } = await importVite();

	const env = loadEnv("development", process.cwd(), "");

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

	const entryFile = pathToFileURL(join(process.cwd(), entry)).href;

	await import(entryFile);

	// wait for the Alepha instance to be initialized (I know, this is not ideal)
	await new Promise((resolve) => setTimeout(resolve, 1000));

	const alepha = global.__alepha as Alepha | undefined;
	if (!alepha) {
		throw new AlephaError(
			"Alepha instance not found. Ensure Alepha is initialized.",
		);
	}

	await alepha.events.emit("configure", alepha);

	return alepha;
};
