import { fileExists } from "./fileExists.ts";

const entries = ["src/index.server.ts", "src/index.ts"];

export const getDefaultEntryFile = async (entry?: string): Promise<string> => {
	if (entry) {
		const exists = await fileExists(entry);
		if (exists) {
			return entry;
		} else {
			throw new Error(`Entry file "${entry}" does not exist.`);
		}
	}

	for (const entry of entries) {
		const exists = await fileExists(entry);
		if (exists) {
			return entry;
		}
	}

	throw new Error(
		`No default entry file found. Please add src/index.server.ts or src/index.ts to your project.`,
	);
};
