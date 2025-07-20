import type { Alepha } from "../Alepha.ts";
import { $cursor } from "../descriptors/$cursor.ts";
import type { InstantiableClass, Service } from "../interfaces/Service.ts";

// ---------------------------------------------------------------------------------------------------------------------

export const descriptorEvents = {
	events: new Map<Service, ((alepha: Alepha) => void)[]>(),
	on(descriptor: Service, callback: (alepha: Alepha) => void): void {
		const callbacks = this.events.get(descriptor) ?? [];
		callbacks.push(callback);
		this.events.set(descriptor, callbacks);
	},
	emit(descriptor: Service, alepha: Alepha): void {
		for (const callback of this.events.get(descriptor) ?? []) {
			callback(alepha);
		}
	},
	bind(when: Service, register: Service): void {
		this.on(when, (alepha: Alepha) => {
			if (!alepha.isLocked()) {
				alepha.with(register);
			}
		});
	},
};

// ---------------------------------------------------------------------------------------------------------------------

export interface DescriptorArgs<T extends object = {}> {
	options: T;
	alepha: Alepha;
	service?: Service;
	module?: Service;
}

export abstract class Descriptor<T extends object = {}> {
	public readonly alepha: Alepha;
	public readonly options: T;
	public readonly service?: Service;
	public readonly module?: Service;

	constructor(args: DescriptorArgs<T>) {
		this.alepha = args.alepha;
		this.options = args.options;
		this.service = args.service;
		this.module = args.module;
	}
}

// ---------------------------------------------------------------------------------------------------------------------

export type DescriptorFactory<
	TOptions extends object,
	TDescriptor extends Descriptor<TOptions>,
> = {
	(options: TOptions): TDescriptor;
	descriptor: InstantiableClass<TDescriptor>;
};

export type DescriptorFactoryLike<T extends object = any> = (options: T) => any;

export const createFactory = <
	TOptions extends object,
	TDescriptor extends Descriptor<TOptions>,
>(
	descriptor: InstantiableClass<TDescriptor>,
): DescriptorFactory<TOptions, TDescriptor> => {
	const factory = (options: TOptions) => {
		const { context, definition, module } = $cursor();

		descriptorEvents.emit(descriptor, context);

		return context.get(descriptor, {
			skipRegistration: true,
			skipCache: true,
			args: [
				{
					options,
					alepha: context,
					service: definition,
					module: module,
				},
			],
		});
	};

	factory.descriptor = descriptor;

	return factory;
};
