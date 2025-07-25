import type { Alepha } from "../Alepha.ts";
import { KIND } from "../constants/KIND.ts";
import {
	type DescriptorFactoryLike,
	descriptorEvents,
} from "../helpers/descriptor.ts";
import type { Module } from "../helpers/Module.ts";
import type { Service, ServiceEntry } from "../interfaces/Service.ts";

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
export const $module = (args: ModuleDescriptorOptions): ModuleDescriptor => {
	const { services = [], descriptors = [], name } = args;

	const Class = {
		// force class name to be the module name
		[name]: class implements Module {
			$name = name;
			$services(alepha: Alepha) {
				if (typeof args.register === "function") {
					args.register(alepha);
				} else {
					for (const service of services) {
						alepha.with(service);
					}
				}
			}
		},
	};

	for (const service of services) {
		const it = typeof service === "function" ? service : service.provide;
		const isModule = !!it.prototype?.$services;
		if (!isModule) {
			descriptorEvents.bind(it, Class[name]);
		}
	}

	for (const factory of descriptors) {
		if (Array.isArray(factory)) {
			descriptorEvents.bind(factory[0][KIND], factory[1]);
		} else {
			descriptorEvents.bind(factory[KIND], Class[name]);
		}
	}

	return Class[name];
};

export type ModuleDescriptor = Service<Module>;

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
	services?: Array<ServiceEntry>;

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
