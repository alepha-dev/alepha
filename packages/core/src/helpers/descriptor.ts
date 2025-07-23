import { Alepha } from "../Alepha.ts";
import { KIND } from "../constants/KIND.ts";
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
	service: InstantiableClass<Service>;
	module?: Service;
}

export interface DescriptorConfig {
	propertyKey: string;
	service: InstantiableClass<Service>;
	module?: Service;
}

export abstract class Descriptor<T extends object = {}> {
	protected readonly alepha: Alepha;

	public readonly options: T;
	public readonly config: DescriptorConfig;

	constructor(args: DescriptorArgs<T>) {
		this.alepha = args.alepha;
		this.options = args.options;
		this.config = {
			propertyKey: "",
			service: args.service,
			module: args.module,
		};
	}

	/**
	 * Called automatically by Alepha after the descriptor is created.
	 */
	protected onInit(): void {
		// this method can be overridden by subclasses to perform initialization logic.
		// - use onInit instead of the constructor when you need to access `config.propertyKey`
		// - onInit must be synchronous
	}
}

// ---------------------------------------------------------------------------------------------------------------------

export type DescriptorFactory<TDescriptor extends Descriptor = Descriptor> = {
	(options: TDescriptor["options"]): TDescriptor;
	[KIND]: InstantiableClass<TDescriptor>;
};

export type DescriptorFactoryLike<T extends object = any> = {
	(options: T): any;
	[KIND]: any;
};

export const createDescriptor = <TDescriptor extends Descriptor>(
	descriptor: InstantiableClass<TDescriptor>,
	options: TDescriptor["options"],
): TDescriptor => {
	const { context, definition, module } = $cursor();

	descriptorEvents.emit(descriptor, context);

	return context.get(descriptor, {
		//skipRegistration: true,
		skipCache: true,
		args: [
			{
				options,
				alepha: context,
				service: definition ?? Alepha,
				module: module,
			},
		],
	});
};
