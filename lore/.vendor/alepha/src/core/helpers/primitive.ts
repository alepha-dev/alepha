import { Alepha } from "../Alepha.ts";
import { KIND } from "../constants/KIND.ts";
import { MODULE } from "../constants/MODULE.ts";
import { AlephaError } from "../errors/AlephaError.ts";
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

  /**
   * Override (partially) the options of this primitive.
   *
   * Options are shallow-merged into the existing options — fields not present
   * in `partial` are preserved. Must be called BEFORE `alepha.start()`;
   * throws once the container has started because options are consumed during
   * start-up (route registration, etc.) and later mutations would have no effect.
   *
   * Typical use case: customize a built-in primitive from a module without
   * forking the whole module.
   *
   * @example Instance-level override
   * ```ts
   * const auth = alepha.inject(AuthRouter);
   * auth.login.override({ lazy: () => import("./MyLogin.tsx") });
   * ```
   *
   * @example Subclass override (constructor body, after super())
   * ```ts
   * class MyAuthRouter extends AuthRouter {
   *   constructor() {
   *     super();
   *     this.login.override({ lazy: () => import("./MyLogin.tsx") });
   *   }
   * }
   * ```
   */
  public override(partial: Partial<T>): this {
    if (this.alepha.isStarted()) {
      throw new AlephaError(
        `Cannot override primitive '${this.config.propertyKey}' after Alepha has started. Call override() before alepha.start() / run().`,
      );
    }
    Object.assign(this.options, partial);
    return this;
  }
}

// ---------------------------------------------------------------------------------------------------------------------

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
