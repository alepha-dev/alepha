import type { Permission } from "@alepha/security";
import { type RouteMethod, routeMethods } from "../constants/routeMethods.ts";
import type { ActionDescriptorOptions } from "../descriptors/$action.ts";
import type { RequestConfigSchema } from "../interfaces/index.ts";

export class ActionDescriptorHelper {
	public name(
		options: ActionDescriptorOptions,
		instance: any,
		key: string,
	): string {
		if (options.name) {
			return options.name;
		}

		return key;
	}

	public path(options: ActionDescriptorOptions, _instance: any, key: string) {
		if (options.path != null) {
			return options.path;
		}
		let path = `/${key}`;

		const params = options.schema?.params?.properties ?? {};
		for (const part of Object.keys(params)) {
			path += `/:${part.toLowerCase()}`;
		}

		return path;
	}

	public method(options: { method?: string; schema?: any }): RouteMethod {
		if (options.method) {
			if (routeMethods.includes(options.method as RouteMethod)) {
				return options.method.toUpperCase() as RouteMethod;
			}
			throw new Error(`Invalid route method: ${options.method}`);
		}

		return options.schema?.body ? "POST" : "GET";
	}

	public permission(
		options: ActionDescriptorOptions,
		instance: any,
		key: string,
	): Permission {
		return {
			group: this.group(options, instance),
			name: options.name ?? key,
			description: options.description,
		};
	}

	public group(options: ActionDescriptorOptions, instance: any): string {
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

	public bodyContentType(options: ActionDescriptorOptions): string | undefined {
		const method = this.method(options);
		const hasBody = method === "POST" || method === "PATCH" || method === "PUT";

		if (hasBody && this.isMultipart(options)) {
			return "multipart/form-data";
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

	public fetchLinks(_url: string) {}
}
