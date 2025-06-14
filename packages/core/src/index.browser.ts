/// <reference types="vite/client" />

import type { Env } from "./Alepha.ts";
import { Alepha } from "./Alepha.ts";
import type { Class } from "./interfaces/Class.ts";
import type { RunOptions } from "./run.ts";

export * from "./index.shared.ts";

export const run = (
	arg: Alepha | Class | ((env?: Env) => Alepha),
	opts?: RunOptions,
): Alepha => {
	const alepha =
		typeof arg === "function" && !arg.prototype
			? (arg as (env?: Env) => Alepha)()
			: arg instanceof Alepha
				? arg
				: Alepha.create({ env: { ...opts?.env } }).with(arg as Class);

	if (import.meta?.hot) {
		import.meta.hot.on("alepha:reload", async () => {
			window.location.reload();
		});
	}

	(async () => {
		try {
			await opts?.configure?.(alepha);

			await alepha.start();

			if (opts?.ready) {
				await opts.ready(alepha);
			}
		} catch (error) {
			alepha.log.error(error);
		}
	})();

	(window as any).alepha = alepha;

	return alepha;
};
