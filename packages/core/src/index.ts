import { AsyncLocalStorage } from "node:async_hooks";
import { Alepha } from "./Alepha.ts";
import type { RunOptions } from "./interfaces/Run.ts";
import type { Service } from "./interfaces/Service.ts";
import { AlsProvider } from "./providers/AlsProvider.ts";

export * from "./index.shared.ts";

AlsProvider.create = () => new AsyncLocalStorage();

export const run = (
	entry: Alepha | Service | Array<Service>,
	opts?: RunOptions,
): Alepha => {
	const alepha =
		entry instanceof Alepha
			? entry
			: Alepha.create({ env: { ...process.env, ...opts?.env } });

	if (!(entry instanceof Alepha)) {
		const entries = Array.isArray(entry) ? entry : [entry];
		for (const e of entries) {
			alepha.with(e);
		}
	}

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
			alepha.log.error("Failed to start", error);
			if (typeof process === "object") {
				process.exit(1);
			}
		}
	})();

	return alepha;
};
