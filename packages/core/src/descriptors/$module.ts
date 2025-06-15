import type { Static } from "@sinclair/typebox";
import { KIND, OPTIONS, type Service, type TSchema } from "../index.ts";
import type { ServiceEntry } from "../interfaces/Service.ts";

export interface ModuleDescriptorOptions<T extends TSchema> {
	name: string; // name of the application
	version?: string; // version of the application
	description?: string; // description of the application
	services?: ServiceEntry[] | ((env: Static<T>) => ServiceEntry[]); // list of services to register
	env?: T;
}

export type ModuleDescriptor<T extends TSchema = TSchema> = {
	[KIND]: "MODULE";
	[OPTIONS]: ModuleDescriptorOptions<T>;
};

/**
 * This descriptor can be used to define the application metadata and services.
 */
export const $module = <T extends TSchema>(
	opts: ModuleDescriptorOptions<T>,
): ModuleDescriptor<T> => {
	return {
		[KIND]: "MODULE",
		[OPTIONS]: opts,
	};
};

// ---------------------------------------------------------------------------------------------------------------------

export interface Module {
	/**
	 * The name of the module.
	 */
	name: string;

	/**
	 * The version of the module.
	 */
	version?: string;

	/**
	 * The description of the module.
	 */
	description?: string;

	/**
	 * The services provided by the module.
	 */
	services: Service[];
}

// ---------------------------------------------------------------------------------------------------------------------
