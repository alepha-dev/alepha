import { Alepha } from "../Alepha.ts";
import { KIND } from "../constants/KIND.ts";
import { MODULE } from "../constants/MODULE.ts";
import { $context } from "../descriptors/$context.ts";
import type { InstantiableClass, Service } from "../interfaces/Service.ts";

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
  descriptor: InstantiableClass<TDescriptor> & { [MODULE]?: Service },
  options: TDescriptor["options"],
): TDescriptor => {
  const { alepha, service } = $context();

  if (MODULE in descriptor && descriptor[MODULE]) {
    alepha.with(descriptor[MODULE]);
  }

  return alepha.inject(descriptor, {
    lifetime: "transient",
    args: [
      {
        options,
        alepha: alepha,
        service: service ?? Alepha,
      },
    ],
  });
};
