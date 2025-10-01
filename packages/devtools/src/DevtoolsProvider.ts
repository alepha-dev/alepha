import { $hook, $inject, Alepha } from "@alepha/core";

export class DevtoolsProvider {
	protected readonly alepha = $inject(Alepha);

	protected readonly configure = $hook({
		on: "configure",
		priority: "last",
		handler: async () => {
			// TODO: Implement devtools data collection
		},
	});

	protected readonly start = $hook({
		on: "start",
		priority: "last",
		handler: async () => {
			// TODO: Implement devtools startup logic
		},
	});

	protected readonly stop = $hook({
		on: "stop",
		priority: "first",
		handler: async () => {
			// TODO: Implement devtools cleanup logic
		},
	});
}
