import { Alepha } from "./Alepha.ts";
import type { RunOptions } from "./index.shared.ts";
import type { Service } from "./interfaces/Service.ts";

export * from "./helpers/file.ts";
export * from "./index.shared.ts";

export const run = (entry: Alepha | Service, opts?: RunOptions): Alepha => {
	const alepha =
		entry instanceof Alepha
			? entry
			: Alepha.create({ env: { ...process.env, ...opts?.env } }).with(
					entry as Service,
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
