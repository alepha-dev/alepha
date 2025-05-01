import type { Static } from "@alepha/core";
import { $hook, $inject, $logger, Alepha, KIND, t } from "@alepha/core";
import {
	$route,
	type RequestConfig,
	type RouteGenericRequestOptions,
	type RouteRequestArgs,
} from "../descriptors/$route";
import { RouteDescriptorHelper } from "../helpers/RouteDescriptorHelper";
import type { FetchFactoryAdditionalOptions } from "../services/HttpClient";
import { HttpClient } from "../services/HttpClient";

const envSchema = t.object({
	SERVER_API_URL: t.string({
		default: "/api",
	}),
});

declare module "@alepha/core" {
	interface Env extends Partial<Static<typeof envSchema>> {}
}

export class RouteBrowserDescriptorProvider {
	protected readonly log = $logger();
	protected readonly alepha = $inject(Alepha);
	protected readonly client = $inject(HttpClient);
	protected readonly env = $inject(envSchema);
	protected readonly helper = $inject(RouteDescriptorHelper);

	protected readonly configure = $hook({
		name: "configure",
		handler: () => {
			this.processDescriptors();
		},
	});

	/**
	 *
	 */
	public processDescriptors() {
		const descriptors = this.alepha.getDescriptorValues($route);
		for (const { value, instance, key } of descriptors) {
			this.registerApi(value, instance, key);
		}
	}

	/**
	 * Transform a route descriptor item into a http client.
	 *
	 * @param value - The route descriptor value.
	 * @param instance - Class instance where the route is defined.
	 * @param key - Property name of the route.
	 */
	protected registerApi(value: any, instance: any, key: string) {
		const fetcher = this.client.createFetcher(
			{
				...value.options,
				url: this.helper.url(value.options, instance, key),
				method: this.helper.method(value.options),
			},
			this.options(),
		);

		const $ = (
			config: RouteRequestArgs<RequestConfig>,
			opts: RouteGenericRequestOptions = {},
		) => fetcher(config ?? {}, opts?.fetch);

		$[KIND] = "ROUTE";
		$.options = value.options;

		$.fetch = (
			config: RouteRequestArgs<RequestConfig>,
			opts: RouteGenericRequestOptions,
		) => fetcher(config ?? {}, opts?.fetch);

		$.permission = () => this.helper.permission(value.options, instance, key);

		instance[key] = $;
	}

	/**
	 * Get the options.
	 *
	 * @param override
	 */
	public options(
		override: FetchFactoryAdditionalOptions = {},
	): FetchFactoryAdditionalOptions {
		return {
			host: this.env.SERVER_API_URL,
			...override,
		};
	}
}
