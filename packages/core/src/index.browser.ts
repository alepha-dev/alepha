import { Alepha } from "./Alepha.ts";
import type { RunOptions } from "./index.shared.ts";
import type { Service } from "./interfaces/Service.ts";

export * from "./index.shared.ts";

export const run = (
	entry: Alepha | Service | Array<Service>,
	opts?: RunOptions,
): Alepha => {
	const alepha =
		entry instanceof Alepha
			? entry
			: Alepha.create({ env: { ...opts?.env } }).with(
					...(Array.isArray(entry) ? entry : [entry]),
				);

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
