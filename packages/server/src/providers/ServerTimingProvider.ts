import { $hook, $inject, Alepha } from "@alepha/core";
import { $logger } from "@alepha/logger";
import type { ServerRequest } from "../interfaces/ServerRequest.ts";

type TimingMap = Record<string, [number, number]>;

export class ServerTimingProvider {
	protected readonly log = $logger();
	protected readonly alepha = $inject(Alepha);

	public readonly onRequest = $hook({
		priority: "first",
		on: "server:onRequest",
		handler: async ({ request }) => {
			request.metadata.timing = {};
			request.metadata.timing[this.handlerName] = [Date.now()];
		},
	});

	public readonly onResponse = $hook({
		priority: "last",
		on: "server:onResponse",
		handler: async ({ request }) => {
			if (request.metadata.timing) {
				this.setDuration(this.handlerName, request.metadata.timing);

				let timingHeader = "";

				for (const [name, [start, duration]] of Object.entries(
					request.metadata.timing as TimingMap,
				)) {
					if (typeof start !== "number" || typeof duration !== "number") {
						this.log.warn(
							`Invalid timing for '${name}': [${start}, ${duration}]`,
						);
						continue;
					}

					const formattedName = name.replace(/[^a-zA-Z0-9-]/g, "-");
					timingHeader += `${formattedName};dur=${duration}, `;
				}

				if (request.reply.headers["Server-Timing"]) {
					request.reply.headers["Server-Timing"] += `, ${timingHeader}`;
				} else {
					request.reply.headers["Server-Timing"] = timingHeader;
				}
			}
		},
	});

	protected get handlerName() {
		return `request`;
	}

	public beginTiming(name: string): void {
		const request = this.alepha.context.get<ServerRequest>("request");
		if (!request) {
			return;
		}

		request.metadata ??= {};
		request.metadata.timing ??= {};
		request.metadata.timing[name] = [Date.now()];
	}

	public endTiming(name: string): void {
		const request = this.alepha.context.get<ServerRequest>("request");
		if (!request) {
			return;
		}

		if (!request.metadata?.timing || !(name in request.metadata.timing)) {
			this.log.warn(`No timing found for '${name}'.`);
			return;
		}

		const start = request.metadata.timing[name]?.[0];
		if (typeof start !== "number") {
			this.log.warn(`Invalid timing start for '${name}': ${start}`);
			return;
		}

		this.setDuration(name, request.metadata.timing);
	}

	protected setDuration(name: string, timing: TimingMap): void {
		timing[name] = [timing[name][0], Date.now() - timing[name][0]];
	}
}
