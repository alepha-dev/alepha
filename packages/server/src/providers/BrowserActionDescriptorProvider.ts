import { OPTIONS, type Static } from "@alepha/core";
import { $hook, $inject, $logger, Alepha, KIND, t } from "@alepha/core";
import {
	$route,
	type ClientRequestEntry,
	type ClientRequestOptions,
	type RouteDescriptor,
} from "../descriptors/$action.ts";
import { RouteDescriptorHelper } from "../helpers/RouteDescriptorHelper.ts";
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
	protected readonly helper = $inject(RouteDescriptorHelper);

	public readonly configure = $hook({
		name: "configure",
		handler: () => {
			this.configureActions();
		},
	});

	public configureActions() {
		const descriptors = this.alepha.getDescriptorValues($route);
		for (const { value, instance, key } of descriptors) {
			this.registerAction(value, instance, key);
		}
	}

	public registerAction(value: RouteDescriptor, instance: any, key: string) {
		const fetcher = this.client.createFetchFunction(
			this.helper.link(value[OPTIONS], instance, key),
			{
				host: this.env.SERVER_API_URL,
			},
		);

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
