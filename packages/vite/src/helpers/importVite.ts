import { createRequire } from "node:module";
import type * as vite from "vite";

export const importVite = async (): Promise<typeof vite> => {
	try {
		return createRequire(import.meta.url)("rolldown-vite");
	} catch (_error) {
		try {
			return createRequire(import.meta.url)("vite");
		} catch (_error) {
			throw new Error(
				"Vite is not installed. Please install it with `npm install vite`.",
			);
		}
	}
};
