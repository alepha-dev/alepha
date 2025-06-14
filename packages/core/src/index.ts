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
			? (arg as (env?: Env) => Alepha)(process.env)
			: arg instanceof Alepha
				? arg
				: Alepha.create({ env: { ...process.env, ...opts?.env } }).with(
						arg as Class,
					);

	(globalThis as any).__alepha = alepha;

	if (alepha.isServerless()) {
		return alepha;
	}

	// default runner
	(async () => {
		try {
			await opts?.configure?.(alepha);

			await alepha.start();

			if (opts?.ready) {
				await opts.ready(alepha);
			}

			if (opts?.once) {
				await alepha.stop();
				return alepha;
			}

			if (typeof process === "object") {
				const traps = ["SIGTERM", "SIGINT", "SIGUSR2"];

				for (const trap of traps) {
					process.once(trap, async () => {
						alepha.log.info("Received signal", { trap });
						try {
							await alepha.stop();
							console.log(" ");
							process.exit(0);
						} catch (error) {
							alepha.log.error(error);
							process.exit(1);
						}
					});
				}
			}
		} catch (error) {
			alepha.log.error(error);
			if (typeof process === "object") {
				process.exit(1);
			}
		}
	})();

	return alepha;
};
