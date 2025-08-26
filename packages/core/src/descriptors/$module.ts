import type { Alepha } from "../Alepha.ts";
import { KIND } from "../constants/KIND.ts";
import { MODULE } from "../constants/MODULE.ts";
import { AlephaError } from "../errors/AlephaError.ts";
import type { DescriptorFactoryLike } from "../helpers/descriptor.ts";
import type { Service } from "../interfaces/Service.ts";

/**
 * Wrap Services and Descriptors into a Module.
 *
 * - A module is just a Service extended {@link Module}.
 * - You must attach a `name` to it.
 * - Name must follow the pattern: `project.module.submodule`.
 *
 * @example
 * ```ts
 * import { $module } from "@alepha/core";
 * import { MyService } from "./MyService.ts";
 *
 * // export MyService, so it can be used everywhere
 * export * from "./MyService.ts";
 *
 * export default $module({
 *  name: "my.project.module",
 *  // MyService will have a module context "my.project.module"
 *  services: [MyService],
 * });
 * ```
 *
 * ## Why Modules?
 *
 * ### Logging
 *
 * By default, AlephaLogger will log the module name in the logs.
 * This helps to identify where the logs are coming from.
 *
 * You can also set different log levels for different modules.
 * It means you can set 'some.very.specific.module' to 'debug' and keep the rest of the application to 'info'.
 *
 * ### Modulith
 *
 * Force to structure your application in modules, even if it's a single deployable unit.
 * It helps to keep a clean architecture and avoid monolithic applications.
 *
 * You can also use `MODULE_INCLUDE` and `MODULE_EXCLUDE` environment variables to load only specific modules.
 *
 * A strict mode is planned to enforce module boundaries. Throwing errors when a service from another module is injected.
 *
 * ### When not to use Modules?
 *
 * Small applications does not need modules. It's better to keep it simple.
 * Modules are more useful when the application grows and needs to be structured.
 * If we speak with `$actions`, a module should be used when you have more than 30 actions in a single module.
 */
export const $module = (options: ModuleDescriptorOptions): Service<Module> => {
	const { services = [], descriptors = [], name } = options;

	if (!name || !Module.NAME_REGEX.test(name)) {
		throw new AlephaError(
			`Invalid module name '${name}'. It should be in the format of 'project.module.submodule'`,
		);
	}

	const $ = class extends Module {
		options = options;

		register(alepha: Alepha): void {
			if (typeof options.register === "function") {
				options.register(alepha);
				return;
			}

			for (const service of services) {
				alepha.inject(service, {
					parent: this.constructor as Service<Module>,
				});
			}
		}
	};

	Object.defineProperty($, "name", {
		value: name,
		writable: false,
	});

	for (const service of services) {
		if (!Module.is(service)) {
			(service as WithModule)[MODULE] = $;
		}
	}

	for (const factory of descriptors) {
		if (typeof factory[KIND] === "function") {
			factory[KIND][MODULE] = $;
		}
	}

	return $;
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

/**
 * Base class for all modules.
 */
export abstract class Module {
	public abstract readonly options: ModuleDescriptorOptions;

	public abstract register(alepha: Alepha): void;

	static NAME_REGEX = /^[a-z]+(\.[a-z][a-z0-9]*)*$/;

	/**
	 * Check if a Service is a Module.
	 */
	static is(ctor: Service): boolean {
		return ctor.prototype instanceof Module;
	}

	/**
	 * Get the Module of a Service.
	 */
	static of(ctor: Service): Service<Module> | undefined {
		return (ctor as WithModule)[MODULE];
	}
}

export type WithModule<T extends object = any> = T & {
	[MODULE]?: Service;
};
