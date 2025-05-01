import type { TObject } from "@sinclair/typebox";
import type { Alepha } from "../Alepha";
import { KIND } from "../constants/KIND";
import type { ClassEntry } from "../interfaces/Class";
import type { Static } from "../providers/TypeProvider";
import { $cursor } from "./$cursor";

// !!
// !! WORK IN PROGRESS
// !!

export interface ModuleDescriptorOptions<T extends TObject> {
	/**
	 * Set a module name.
	 */
	name: string;

	/**
	 * Set a module version.
	 */
	version: string;

	/**
	 * Describe the module with a short description.
	 */
	description?: string;

	/**
	 * Set the module environment. Like on/off features or configurations.
	 */
	env?: T;

	/**
	 * Check is module should be enabled.
	 */
	enabled?: boolean | ((env: Static<T>, alepha: Alepha) => boolean | string);

	/**
	 * Set the module dependencies.
	 */
	services?: ClassEntry[];
}

export interface ModuleDescriptor<T extends TObject> {
	[KIND]: "MODULE";
	options: ModuleDescriptorOptions<T>;
}

/**
 *
 *
 */
export const $module = <T extends TObject>(
	options: ModuleDescriptorOptions<T>,
): ModuleDescriptor<T> => {
	const { context } = $cursor();
	const $: ModuleDescriptor<T> = { [KIND]: "MODULE", options };

	if (typeof options.enabled === "function") {
		const enabled = options.enabled(
			options.env ? context.parseEnv(options.env) : {},
			context,
		);
		if (enabled !== true) {
			return $;
		}
	}

	if (options.services) {
		for (const it of options.services) {
			context.register(it);
		}
	}

	return $;
};
