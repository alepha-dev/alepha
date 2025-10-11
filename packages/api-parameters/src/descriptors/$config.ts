import {
	createDescriptor,
	Descriptor,
	type Static,
	type TObject,
} from "@alepha/core";
import type { UserAccount } from "@alepha/security";

export interface ConfigDescriptorOptions<T extends TObject> {
	name?: string;
	description?: string;
	schema: T;
	default: Static<T>;
}

export class ConfigDescriptor<T extends TObject> extends Descriptor<
	ConfigDescriptorOptions<T>
> {
	public get name() {
		return this.options.name || this.config.propertyKey;
	}

	public get current(): Static<T> {
		return this.options.default;
	}

	public get next(): Static<T> | undefined {
		return undefined;
	}

	/**
	 * Apply a new configuration object.
	 */
	public async set(
		value: Static<T>,
		options: {
			user?: UserAccount;
			activationDate?: Date; // default to now
		},
	): Promise<void> {}

	public sub(fn: (curr: Static<T>) => void): void {}
}

export const $config = <T extends TObject>(
	options: ConfigDescriptorOptions<T>,
) => {
	return createDescriptor(ConfigDescriptor<T>, options);
};
