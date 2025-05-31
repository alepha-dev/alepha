import { OPTIONS, type Static } from "@alepha/core";
import { $hook, $inject, $logger, Alepha, KIND, t } from "@alepha/core";
import {
	$action,
	type ActionDescriptor,
	type ClientRequestEntry,
	type ClientRequestOptions,
} from "../descriptors/$action.ts";
import { ActionDescriptorHelper } from "../helpers/ActionDescriptorHelper.ts";
import { HttpClient } from "../services/HttpClient.ts";

const envSchema = t.object({
	SERVER_API_URL: t.string({
		default: "/api",
	}),
});

declare module "@alepha/core" {
	interface Env extends Partial<Static<typeof envSchema>> {}
}

export class BrowserActionDescriptorProvider {
	protected readonly log = $logger();
	protected readonly alepha = $inject(Alepha);
	protected readonly client = $inject(HttpClient);
	protected readonly env = $inject(envSchema);
	protected readonly helper = $inject(ActionDescriptorHelper);

	public readonly configure = $hook({
		name: "configure",
		handler: () => {
			this.configureActions();
		},
	});

	public configureActions() {
		const descriptors = this.alepha.getDescriptorValues($action);
		for (const { value, instance, key } of descriptors) {
			this.registerAction(value, instance, key);
		}
	}

	public registerAction(value: ActionDescriptor, instance: any, key: string) {
		const options = {
			host: this.env.SERVER_API_URL,
		};

		const link = this.helper.link(value[OPTIONS], instance, key);

		const fetcher = this.client.createFetchFunction(link, options);

		const $ = (config: ClientRequestEntry, opts: ClientRequestOptions = {}) =>
			fetcher(config, opts);

		$[KIND] = "ROUTE";
		$[OPTIONS] = value[OPTIONS];

		$.fetch = (config: ClientRequestEntry, opts: ClientRequestOptions = {}) =>
			fetcher(config, opts);

		$.permission = () => this.helper.permission(value[OPTIONS], instance, key);

		instance[key] = $;
	}
}
