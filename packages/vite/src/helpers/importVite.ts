import { createRequire } from "node:module";
import type * as vite from "vite";

export const importVite = async (): Promise<typeof vite> => {
	try {
		// try to import rolldown-vite first, as it is a more optimized version of Vite
		return createRequire(import.meta.url)("rolldown-vite");
	} catch (_error) {
		console.warn(
			"Using Vite instead of rolldown-vite. Please install rolldown-vite for better performance.",
		);
		try {
			return createRequire(import.meta.url)("vite");
		} catch (_error) {
			throw new Error(
				"Vite is not installed. Please install it with `npm install vite` or `npm install rolldown-vite`.",
			);
		}
	}
};
