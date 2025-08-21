import { $env, $hook, t } from "@alepha/core";
import { $logger } from "@alepha/logger";
import { $thread } from "../descriptors/$thread.ts";

export class ThreadProvider {
	protected readonly log = $logger();
	protected readonly env = $env(
		t.object({
			ALEPHA_WORKER: t.optional(t.string()),
		}),
	);

	protected readonly ready = $hook({
		on: "ready",
		handler: async (alepha) => {
			const worker = this.env.ALEPHA_WORKER;
			if (!worker) {
				return;
			}

			const threads = alepha.descriptors($thread);
			for (const thread of threads) {
				if (thread.name === worker) {
					this.log.info(`Run handler: ${thread.name}`);
					await thread.options.handler();
					return;
				}
			}
		},
	});
}
