import type { Permission } from "@alepha/security";
import { type RouteMethod, routeMethods } from "../constants/routeMethods.ts";
import type { RouteDescriptorOptions } from "../descriptors/$action.ts";
import type { RequestConfigSchema } from "../providers/ServerRouterProvider.ts";
import type { HttpClientLink } from "../services/HttpClient.ts";

export class ActionDescriptorHelper {
	public name(
		options: RouteDescriptorOptions,
		instance: any,
		key: string,
	): string {
		if (options.name) {
			return options.name;
		}

		return key;
	}

	public path(
		options: RouteDescriptorOptions,
		instance: any,
		key: string,
		prefix = "",
	) {
		return prefix + (options.path ?? `/${key}`);
	}

	public link(
		options: RouteDescriptorOptions,
		instance: any,
		key: string,
		prefix = "",
	): HttpClientLink {
		return {
			method: this.method(options),
			path: this.path(options, instance, key, prefix),
			name: this.name(options, instance, key),
			group: this.group(options, instance),
			schema: options.schema,
		};
	}

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

	public permission(
		options: RouteDescriptorOptions,
		instance: any,
		key: string,
		prefix = "",
	): Permission {
		return {
			group: this.group(options, instance),
			name: options.name ?? key,
			path: this.path(options, instance, key, prefix),
			method: this.method(options),
			description: options.description,
			contentType: this.bodyContentType(options),
		};
	}

	public group(options: RouteDescriptorOptions, instance: any): string {
		if (options.group) {
			return options.group;
		}

		return this.short(instance.constructor.name);
	}

	public isMultipart(options: { schema?: RequestConfigSchema }): boolean {
		if (options.schema?.body) {
			for (const key in options.schema.body.properties) {
				if (
					options.schema.body.properties[key].type === "string" &&
					options.schema.body.properties[key].format === "binary"
				) {
					return true;
				}
			}
		}
		return false;
	}

	public bodyContentType(options: RouteDescriptorOptions): string | undefined {
		const method = this.method(options);
		const hasBody = method === "POST" || method === "PATCH" || method === "PUT";

		if (hasBody) {
			if (this.isMultipart(options)) {
				return "multipart/form-data";
			}
			if (options.schema?.body) {
				return "application/json";
			}
		}
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
}
