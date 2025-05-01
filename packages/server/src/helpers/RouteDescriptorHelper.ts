import type { Permission } from "@alepha/security";
import {
	type RouteDescriptorOptions,
	type RouteMethod,
	routeMethods,
} from "../descriptors/$route";

export class RouteDescriptorHelper {
	/**
	 *
	 * @param options
	 * @param instance
	 * @param key
	 * @param prefix
	 */
	public url(
		options: { url?: string },
		instance: any,
		key: string,
		prefix = "",
	) {
		const url = options.url ?? `/${key}`;

		if (url.endsWith("/*")) {
			return url;
		}

		return prefix + url;
	}

	/**
	 *
	 * @param options
	 */
	public method(options: {
		method?: string;
		schema?: any;
	}): RouteMethod {
		if (options.method) {
			if (routeMethods.includes(options.method as RouteMethod)) {
				return options.method.toUpperCase() as RouteMethod;
			}
			throw new Error(`Invalid route method: ${options.method}`);
		}

		return options.schema?.body ? "POST" : "GET";
	}

	/**
	 *
	 * @param options
	 * @param instance
	 * @param key
	 */
	public permission(
		options: RouteDescriptorOptions,
		instance: any,
		key: string,
	): string {
		return `${this.group(options, instance)}:${options.name ?? key}`;
	}

	/**
	 *
	 * @param options
	 * @param instance
	 */
	public group(options: RouteDescriptorOptions, instance: any): string {
		if (options.group) {
			return options.group;
		}

		return this.short(instance.constructor.name);
	}

	protected short(name: string) {
		return (
			name.slice(0, 1).toLowerCase() +
			name
				.slice(1)
				.replace(/Controller$|Api$|Ctrl$/i, "")
				.replace(/([A-Z])/g, (g) => `_${g[0].toLowerCase()}`)
				.replace(/_/g, "-")
				.toLowerCase()
		);
	}

	/**
	 * Retrieves the permission from the given route.
	 *
	 * @param route - The route object from which to retrieve the permission.
	 * @return The permission associated with the route, or undefined if not found.
	 */
	public permissionFromRoute(route: {
		schema?: any;
	}): Permission | undefined {
		const schema = route.schema;
		if (
			schema &&
			"operationId" in schema &&
			typeof schema.operationId === "string"
		) {
			return {
				group: schema.tags?.[0]?.toLowerCase(),
				name: schema.operationId,
			};
		}
	}
}
