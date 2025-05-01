/// <reference types="vite/client" />

import type { Env } from "./Alepha";
import { Alepha } from "./Alepha";
import type { Async } from "./interfaces/Async";
import type { Class } from "./interfaces/Class";

export * from "./index.shared";

export const run = (
	arg: Alepha | Class | ((env?: Env) => Alepha),
	opts?: {
		env?: Env;
		ready?: (alepha: Alepha) => Async<void>;
	},
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
