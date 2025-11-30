import { Alepha } from "../Alepha.ts";
import { KIND } from "../constants/KIND.ts";
import { MODULE } from "../constants/MODULE.ts";
import type { InstantiableClass, Service } from "../interfaces/Service.ts";
import { $context } from "../primitives/$context.ts";

// ---------------------------------------------------------------------------------------------------------------------

export interface PrimitiveArgs<T extends object = {}> {
  options: T;
  alepha: Alepha;
  service: InstantiableClass<Service>;
  module?: Service;
}

export interface PrimitiveConfig {
  propertyKey: string;
  service: InstantiableClass<Service>;
  module?: Service;
}

export abstract class Primitive<T extends object = {}> {
  protected readonly alepha: Alepha;

  public readonly options: T;
  public readonly config: PrimitiveConfig;

  constructor(args: PrimitiveArgs<T>) {
    this.alepha = args.alepha;
    this.options = args.options;
    this.config = {
      propertyKey: "",
      service: args.service,
      module: args.module,
    };
  }

  /**
   * Called automatically by Alepha after the primitive is created.
   */
  protected onInit(): void {
    // this method can be overridden by subclasses to perform initialization logic.
    // - use onInit instead of the constructor when you need to access `config.propertyKey`
    // - onInit must be synchronous
  }
}

// ---------------------------------------------------------------------------------------------------------------------

export type PrimitiveFactory<TPrimitive extends Primitive = Primitive> = {
  (options: TPrimitive["options"]): TPrimitive;
  [KIND]: InstantiableClass<TPrimitive>;
};

export type PrimitiveFactoryLike<T extends object = any> = {
  (options: T): any;
  [KIND]: any;
};

export const createPrimitive = <TPrimitive extends Primitive>(
  primitive: InstantiableClass<TPrimitive> & { [MODULE]?: Service },
  options: TPrimitive["options"],
): TPrimitive => {
  const { alepha, service } = $context();

  if (MODULE in primitive && primitive[MODULE]) {
    alepha.with(primitive[MODULE]);
  }

  return alepha.inject(primitive, {
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
