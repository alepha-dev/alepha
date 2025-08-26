import { Alepha } from "../Alepha.ts";
import { KIND } from "../constants/KIND.ts";
import { MODULE } from "../constants/MODULE.ts";
import type { DescriptorFactoryLike } from "../helpers/descriptor.ts";
import type { Service } from "../interfaces/Service.ts";
import { $inject } from "./$inject.ts";

/**
 * Wrap services and descriptors into a module.
 *
 * Module is just a class.
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
export abstract class Module {
	protected readonly alepha = $inject(Alepha);

	/**
	 * Name of the module.
	 *
	 * It should be in the format of `project.module.submodule`.
	 */
	public readonly name: string;

	/**
	 * List of services of the module.
	 * By default, all services will be injected into Alepha application via the `register` method.
	 */
	public readonly services: Array<Service> = [];

	/**
	 * List of $descriptors to register in the module.
	 *
	 */
	public readonly descriptors: Array<DescriptorFactoryLike> = [];

	constructor() {
		this.name ??= this.constructor.name;

		for (const service of this.services) {
			if (!(MODULE in service)) {
				(service as WithModule)[MODULE] = this;
			}
		}

		for (const factory of this.descriptors) {
			if (typeof factory[KIND] === "function") {
				factory[KIND][MODULE] = this;
			}
		}
	}

	/**
	 * Register services in the Alepha instance.
	 * By default, it will register all services in the `services` array.
	 * You can override this method to customize the registration process.
	 */
	public register(alepha: Alepha): void {
		for (const service of this.services) {
			alepha.with(service);
		}
	}

	public toModuleName = (name: string): string => {
		// Remove optional "Module" suffix
		name = name.replace(/Module$/, "");

		// Split PascalCase into words
		const parts = name.match(/[A-Z][a-z0-9]*/g);

		if (!parts) return name.toLowerCase();

		return parts.map((p) => p.toLowerCase()).join(".");
	};
}

export type WithModule<T extends object = any> = T & {
	[MODULE]?: Service;
};
