import type { Class } from "../interfaces/Class.ts";
import { $cursor } from "./$cursor.ts";

export const $module = (opts: { services: Array<Class> }) => {
	const { context } = $cursor();
	for (const service of opts.services) {
		context.register(service);
	}
	return {};
};
