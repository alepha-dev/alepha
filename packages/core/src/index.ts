import type { Env } from "./Alepha";
import { Alepha } from "./Alepha";
import type { Async } from "./interfaces/Async";
import type { Class } from "./interfaces/Class";

export * from "./index.shared";

export const run = (
	arg: Alepha | Class | ((env?: Env) => Alepha),
	opts?: {
		env?: Env;
		configure?: (alepha: Alepha) => Async<void>;
		ready?: (alepha: Alepha) => Async<void>;
	},
): Alepha => {
	const alepha =
		typeof arg === "function" && !arg.prototype
			? (arg as (env?: Env) => Alepha)(process.env)
			: arg instanceof Alepha
				? arg
				: Alepha.create({ env: { ...process.env, ...opts?.env } }).with(
						arg as Class,
					);

	if (alepha.isServerless()) {
		(globalThis as any).alepha = alepha;
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

			if (typeof process === "object") {
				const traps = [
					"SIGTERM",
					"SIGINT",
					"SIGUSR2",
					"unhandledRejection",
					"uncaughtException",
				];

				for (const trap of traps) {
					process.once(trap, async () => {
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
