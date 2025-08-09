import type { Alepha } from "../Alepha.ts";
import { KIND } from "../constants/KIND.ts";
import { MODULE } from "../constants/MODULE.ts";
import { OPTIONS } from "../constants/OPTIONS.ts";
import type { DescriptorFactoryLike } from "../helpers/descriptor.ts";
import type { Service } from "../interfaces/Service.ts";

/**
 * Wrap services and descriptors into a module.
 *
 * Module is just a class.
 * You must attach a `name` to it.
 *
 * It's recommended to use `project.module.submodule` format.
 *
 * @example
 * ```ts
 * import { $module } from "@alepha/core";
 * import { MyService } from "./MyService.ts";
 *
 * // export MyService so it can be used everywhere
 * export * from "./MyService.ts";
 *
 * export default $module({
 *  name: "my.project.module",
 *  // MyService will have a module context "my.project.module"
 *  services: [MyService],
 * });
 * ```
 *
 * - Module is used for logging and other purposes.
 * - It's useful for large applications or libraries to group services and descriptors together.
 * - It's probably overkill for small applications.
 */
export const $module = (options: ModuleDescriptorOptions): Service<Module> => {
	const { services = [], descriptors = [], name } = options;

	const Class = {
		// force class name to be the module name
		[name]: class {
			static [MODULE] = true;
			[KIND] = "MODULE" as const;
			[OPTIONS] = options;

			register(alepha: Alepha): void {
				if (typeof options.register === "function") {
					options.register(alepha);
					return;
				}

				for (const service of services) {
					alepha.with(service);
				}
			}
		},
	};

	for (const service of services) {
		if (!(MODULE in service)) {
			(service as ServiceWithModule)[MODULE] = Class[name];
		}
	}

	for (const factory of descriptors) {
		if (typeof factory[KIND] === "function") {
			factory[KIND][MODULE] = Class[name];
		}
	}

	return Class[name];
};

// ---------------------------------------------------------------------------------------------------------------------

export interface ModuleDescriptorOptions {
	/**
	 * Name of the module.
	 *
	 * It should be in the format of `project.module.submodule`.
	 */
	name: string;

	/**
	 * List of services to register in the module.
	 */
	services?: Array<Service>;

	/**
	 * List of $descriptors to register in the module.
	 */
	descriptors?: Array<DescriptorFactoryLike>;

	/**
	 * By default, module will register all services.
	 * You can override this behavior by providing a register function.
	 * It's useful when you want to register services conditionally or in a specific order.
	 */
	register?: (alepha: Alepha) => void;
}

// ---------------------------------------------------------------------------------------------------------------------

export interface Module {
	[KIND]: "MODULE";
	[OPTIONS]: ModuleDescriptorOptions;
	register: (alepha: Alepha) => void;
}

export type ServiceWithModule<T extends object = any> = T & {
	[MODULE]?: Service;
};

// ---------------------------------------------------------------------------------------------------------------------

export const isModule = (value: unknown): value is Module => {
	return (
		typeof value === "object" &&
		!!value &&
		OPTIONS in value &&
		KIND in value &&
		value[KIND] === "MODULE"
	);
};

export const toModuleName = (name: string): string => {
	// Remove optional "Module" suffix
	name = name.replace(/Module$/, "");

	// Split PascalCase into words
	const parts = name.match(/[A-Z][a-z0-9]*/g);

	if (!parts) return name.toLowerCase();

	return parts.map((p) => p.toLowerCase()).join(".");
};
