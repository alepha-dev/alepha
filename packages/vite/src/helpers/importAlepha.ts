import type { Alepha } from "@alepha/core";
import { importVite } from "./importVite.ts";

export const importAlepha = async (entry: string): Promise<Alepha> => {
	const { runnerImport, loadEnv } = await importVite();

	const env = loadEnv("development", process.cwd(), "");
	if (global.__alepha) {
		return global.__alepha as Alepha;
	}

	for (const key in env) {
		process.env[key] = env[key];
	}

	process.env.VITE_ALEPHA_DEV = "true";
	process.env.LOG_LEVEL = "error";

	await runnerImport(entry);

	const alepha = global.__alepha as Alepha | undefined;
	if (!alepha) {
		throw new Error("Alepha instance not found. Ensure Alepha is initialized.");
	}

	await alepha.emit("configure", alepha);

	return alepha;
};
