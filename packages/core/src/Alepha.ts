import type { Static, TObject } from "typebox";
import { KIND } from "./constants/KIND.ts";
import { MODULE } from "./constants/MODULE.ts";
import { OPTIONS } from "./constants/OPTIONS.ts";
import type { InjectOptions } from "./descriptors/$inject.ts";
import { Module, type WithModule } from "./descriptors/$module.ts";
import { CircularDependencyError } from "./errors/CircularDependencyError.ts";
import { ContainerLockedError } from "./errors/ContainerLockedError.ts";
import { TooLateSubstitutionError } from "./errors/TooLateSubstitutionError.ts";
import { Descriptor } from "./helpers/descriptor.ts";
import { __alephaRef } from "./helpers/ref.ts";
import type { Async } from "./interfaces/Async.ts";
import type { LoggerInterface } from "./interfaces/LoggerInterface.ts";
import {
  type InstantiableClass,
  isClass,
  type RunFunction,
  type Service,
  type ServiceEntry,
} from "./interfaces/Service.ts";
import { AlsProvider } from "./providers/AlsProvider.ts";
import { CodecManager } from "./providers/CodecManager.ts";
import { EventManager } from "./providers/EventManager.ts";
import { StateManager } from "./providers/StateManager.ts";
import type { TSchema } from "./providers/TypeProvider.ts";

/**
 * Core container of the Alepha framework.
 *
 * It is responsible for managing the lifecycle of services,
 * handling dependency injection,
 * and providing a unified interface for the application.
 *
 * @example
 * ```ts
 * import { Alepha, run } from "alepha";
 *
 * class MyService {
 *   // business logic here
 * }
 *
 * const alepha = Alepha.create({
 *   // state, env, and other properties
 * })
 *
 * alepha.with(MyService);
 *
 * run(alepha); // trigger .start (and .stop) automatically
 * ```
 *
 * ### Alepha Factory
 *
 * Alepha.create() is an enhanced version of new Alepha().
 * - It merges `process.env` with the provided state.env when available.
 * - It populates the test hooks for Vitest or Jest environments when available.
 *
 * new Alepha() is fine if you don't need these helpers.
 *
 * ### Platforms & Environments
 *
 * Alepha is designed to work in various environments:
 * - **Browser**: Runs in the browser, using the global `window` object.
 * - **Serverless**: Runs in serverless environments like Vercel or Vite.
 * - **Test**: Runs in test environments like Jest or Vitest.
 * - **Production**: Runs in production environments, typically with NODE_ENV set to "production".
 * * You can check the current environment using the following methods:
 *
 * - `isBrowser()`: Returns true if the App is running in a browser environment.
 * - `isServerless()`: Returns true if the App is running in a serverless environment.
 * - `isTest()`: Returns true if the App is running in a test environment.
 * - `isProduction()`: Returns true if the App is running in a production environment.
 *
 * ### State & Environment
 *
 * The state of the Alepha container is stored in the `store` property.
 * Most important property is `store.env`, which contains the environment variables.
 *
 * ```ts
 * const alepha = Alepha.create({ env: { MY_VAR: "value" } });
 *
 * // You can access the environment variables using alepha.env
 * console.log(alepha.env.MY_VAR); // "value"
 *
 * // But you should use $env() descriptor to get typed values from the environment.
 * class App {
 *   env = $env(
 *     t.object({
 *  	   MY_VAR: t.text(),
 *     })
 *   );
 * }
 * ```
 *
 * ### Modules
 *
 * Modules are a way to group services together.
 * You can register a module using the `$module` descriptor.
 *
 * ```ts
 * import { $module } from "alepha";
 *
 * class MyLib {}
 *
 * const myModule = $module({
 *   name: "my.project.module",
 *   services: [MyLib],
 * });
 * ```
 *
 * Do not use modules for small applications.
 *
 * ### Hooks
 *
 * Hooks are a way to run async functions from all registered providers/services.
 * You can register a hook using the `$hook` descriptor.
 *
 * ```ts
 * import { $hook } from "alepha";
 *
 * class App {
 * 	 log = $logger();
 * 	 onCustomerHook = $hook({
 * 			on: "my:custom:hook",
 * 			handler: () => {
 * 		 	  this.log?.info("App is being configured");
 * 	 		},
 * 	  });
 * 	}
 *
 * Alepha.create()
 * 	 .with(App)
 * 	 .start()
 * 	 .then(alepha => alepha.events.emit("my:custom:hook"));
 * ```
 *
 * 	Hooks are fully typed. You can create your own hooks by using module augmentation:
 *
 * 	```ts
 * 	declare module "alepha" {
 * 		interface Hooks {
 * 		  "my:custom:hook": {
 * 				arg1: string;
 * 		  }
 * 		}
 * 	}
 * 	```
 *
 * 	@module alepha
 */
export class Alepha {
  /**
   * Creates a new instance of the Alepha container with some helpers:
   *
   * - merges `process.env` with the provided state.env when available.
   * - populates the test hooks for Vitest or Jest environments when available.
   *
   * If you are not interested about these helpers, you can use the constructor directly.
   */
  public static create(state: Partial<State> = {}): Alepha {
    // merge process.env with the state.env
    if (typeof process === "object" && typeof process.env === "object") {
      state.env = {
        ...state.env,
        ...process.env,
      };
    }

    const alepha = new Alepha(state);

    if (alepha.isTest()) {
      // inject global hooks for testing purposes
      // > for vitest, { globals: true } is required in the config
      const g = globalThis as any;
      const beforeAll = state["alepha.test.beforeAll"] ?? g.beforeAll;
      const afterAll = state["alepha.test.afterAll"] ?? g.afterAll;
      const afterEach = state["alepha.test.afterEach"] ?? g.afterEach;
      const onTestFinished =
        state["alepha.test.onTestFinished"] ?? g.onTestFinished;

      beforeAll?.(() => alepha.start());
      afterAll?.(() => alepha.stop());

      try {
        onTestFinished?.(() => alepha.stop());
      } catch (_error) {
        // ignore
      }

      alepha.state
        .set("alepha.test.beforeAll", beforeAll)
        .set("alepha.test.afterAll", afterAll)
        .set("alepha.test.afterEach", afterEach)
        .set("alepha.test.onTestFinished", onTestFinished);
    }

    return alepha;
  }

  /**
   * Flag indicating whether the App won't accept any further changes.
   * Pass to true when #start() is called.
   */
  protected locked = false;

  /**
   * True if the App has been configured.
   */
  protected configured = false;

  /**
   * True if the App has started.
   */
  protected started = false;

  /**
   * True if the App is ready.
   */
  protected ready = false;

  /**
   * A promise that resolves when the App has started.
   */
  protected starting?: PromiseWithResolvers<this>;

  /**
   * Initial state of the container.
   *
   * > Used to initialize the StateManager.
   */
  protected init: Partial<State>;

  /**
   * During the instantiation process, we keep a list of pending instantiations.
   * > It allows us to detect circular dependencies.
   */
  protected pendingInstantiations: Service[] = [];

  /**
   * Cache for environment variables.
   * > It allows us to avoid parsing the same schema multiple times.
   */
  protected cacheEnv: Map<TSchema, any> = new Map();

  /**
   * List of modules that are registered in the container.
   *
   * Modules are used to group services and provide a way to register them in the container.
   */
  protected modules: Array<Module> = [];

  /**
   * List of service substitutions.
   *
   * Services registered here will be replaced by the specified service when injected.
   */
  protected substitutions = new Map<Service, { use: Service }>();

  /**
   * Registry of descriptors.
   */
  protected descriptorRegistry = new Map<
    Service<Descriptor>,
    Array<Descriptor>
  >();

  /**
   *  List of all services + how they are provided.
   */
  protected registry: Map<Service, ServiceDefinition> = new Map();

  // -------------------------------------------------------------------------------------------------------------------

  /**
   * Node.js feature that allows to store context across asynchronous calls.
   *
   * This is used for logging, tracing, and other context-related features.
   *
   * Mocked for browser environments.
   */
  public get context(): AlsProvider {
    return this.inject(AlsProvider);
  }

  /**
   * Event manager to handle lifecycle events and custom events.
   */
  public get events(): EventManager {
    return this.inject(EventManager, {
      args: [{ logFn: () => this.log }],
    });
  }

  /**
   * State manager to store arbitrary values.
   */
  public get state(): StateManager<State> {
    return this.inject(StateManager, {
      args: [this.init],
    });
  }

  /**
   * Codec manager for encoding and decoding data with different formats.
   *
   * Supports multiple codec formats (JSON, Protobuf, etc.) with a unified interface.
   */
  public get codec(): CodecManager {
    return this.inject(CodecManager);
  }

  /**
   * Get logger instance.
   */
  public get log(): LoggerInterface | undefined {
    return this.state.get("alepha.logger");
  }

  /**
   * The environment variables for the App.
   */
  public get env(): Readonly<Env> {
    return this.state.get("env") ?? {};
  }

  constructor(init: Partial<State> = {}) {
    this.init = init;
  }

  /**
   * True when start() is called.
   *
   * -> No more services can be added, it's over, bye!
   */
  public isLocked(): boolean {
    return this.locked;
  }

  /**
   * Returns whether the App is configured.
   *
   * It means that Alepha#configure() has been called.
   *
   * > By default, configure() is called automatically when start() is called, but you can also call it manually.
   */
  public isConfigured(): boolean {
    return this.configured;
  }

  /**
   * Returns whether the App has started.
   *
   * It means that #start() has been called but maybe not all services are ready.
   */
  public isStarted(): boolean {
    return this.started;
  }

  /**
   * True if the App is ready. It means that Alepha is started AND ready() hook has beed called.
   */
  public isReady(): boolean {
    return this.ready;
  }

  /**
   * True if the App is running in a browser environment.
   */
  public isBrowser(): boolean {
    return typeof window !== "undefined"; // pretty cheap check
  }

  /**
   * Returns whether the App is running in Vite dev mode.
   */
  public isViteDev(): boolean {
    if (this.isBrowser()) {
      return false;
    }

    return !!this.env.VITE_ALEPHA_DEV;
  }

  /**
   * Returns whether the App is running in a serverless environment.
   */
  public isServerless(): boolean {
    if (this.isBrowser()) {
      return false;
    }

    if (this.env.VERCEL_REGION) {
      return true;
    }

    if (this.env.ALEPHA_SERVERLESS) {
      return true;
    }

    return false;
  }

  /**
   * Returns whether the App is in test mode. (Running in a test environment)
   *
   * > This is automatically set when running tests with Jest or Vitest.
   */
  public isTest(): boolean {
    const env = this.env.NODE_ENV;
    return env === "test";
  }

  /**
   * Returns whether the App is in production mode. (Running in a production environment)
   *
   * > This is automatically set by Vite or Vercel. However, you have to set it manually when running Docker apps.
   */
  public isProduction(): boolean {
    const env = this.env.NODE_ENV;
    return env === "production";
  }

  // -------------------------------------------------------------------------------------------------------------------

  /**
   * Starts the App.
   *
   * - Lock any further changes to the container.
   * - Run "configure" hook for all services. Descriptors will be processed.
   * - Run "start" hook for all services. Providers will connect/listen/...
   * - Run "ready" hook for all services. This is the point where the App is ready to serve requests.
   *
   * @return A promise that resolves when the App has started.
   */
  public async start(): Promise<this> {
    if (this.ready) {
      this.log?.debug("App is already started, skipping...");
      return this;
    }

    // make sure that start is called only once
    if (this.starting) {
      this.log?.warn("App is already starting, waiting for it to finish...");
      return this.starting.promise;
    }

    this.codec; // ensure codec is initialized

    this.starting = Promise.withResolvers();

    const now = Date.now();

    this.log?.info("Starting App...");

    for (const [key] of this.substitutions.entries()) {
      this.inject(key);
    }

    const target = this.state.get("alepha.target");
    if (target) {
      this.registry = new Map();
      this.descriptorRegistry = new Map();
      this.with(target);
    }

    this.locked = true;

    await this.events.emit("configure", this, { log: true });

    this.configured = true;

    await this.events.emit("start", this, { log: true });

    this.started = true;

    await this.events.emit("ready", this, { log: true });

    this.log?.info(`App is now ready [${Date.now() - now}ms]`);

    this.ready = true;

    this.starting.resolve(this);
    this.starting = undefined;

    return this;
  }

  /**
   * Stops the App.
   *
   * - Run "stop" hook for all services.
   *
   * Stop will NOT reset the container.
   * Stop will NOT unlock the container.
   *
   * > Stop is used to gracefully shut down the application, nothing more. There is no "restart".
   *
   * @return A promise that resolves when the App has stopped.
   */
  public async stop(): Promise<void> {
    if (!this.started) {
      return;
    }

    this.log?.info("Stopping App...");
    await this.events.emit("stop", this, { reverse: true, log: true });
    this.log?.info("App is now off");

    this.started = false;
    this.ready = false;
  }

  // -------------------------------------------------------------------------------------------------------------------

  /**
   * Check if entry is registered in the container.
   */
  public has(
    entry: ServiceEntry,
    opts: {
      /**
       * Check if the entry is registered in the pending instantiation stack.
       *
       * @default true
       */
      inStack?: boolean;
      /**
       * Check if the entry is registered in the container registry.
       *
       * @default true
       */
      inRegistry?: boolean;
      /**
       * Check if the entry is registered in the substitutions.
       *
       * @default true
       */
      inSubstitutions?: boolean;
      /**
       * Where to look for registered services.
       *
       * @default this.registry
       */
      registry?: Map<Service, ServiceDefinition>;
    } = {},
  ): boolean {
    if (entry === Alepha) {
      return true;
    }

    const {
      inStack = true,
      inRegistry = true,
      inSubstitutions = true,
      registry = this.registry,
    } = opts;

    const { provide } =
      typeof entry === "object" && "provide" in entry
        ? entry
        : { provide: entry };

    if (inSubstitutions) {
      const substitute = this.substitutions.get(provide);
      if (substitute) {
        return true;
      }
    }

    if (inRegistry) {
      const match = registry.get(provide);
      if (match) {
        return true;
      }
    }

    if (inStack) {
      const substitute = this.substitutions.get(provide)?.use;
      if (substitute && this.pendingInstantiations.includes(substitute)) {
        return true;
      }

      return this.pendingInstantiations.includes(provide);
    }

    return false;
  }

  /**
   * Registers the specified service in the container.
   *
   * - If the service is ALREADY registered, the method does nothing.
   * - If the service is NOT registered, a new instance is created and registered.
   *
   * Method is chainable, so you can register multiple services in a single call.
   *
   * > ServiceEntry allows to provide a service **substitution** feature.
   *
   * @example
   * ```ts
   * class A { value = "a"; }
   * class B { value = "b"; }
   * class M { a = $inject(A); }
   *
   * Alepha.create().with({ provide: A, use: B }).get(M).a.value; // "b"
   * ```
   *
   * > **Substitution** is an advanced feature that allows you to replace a service with another service.
   * > It's useful for testing or for providing different implementations of a service.
   * > If you are interested in configuring a service, use Alepha#configure() instead.
   *
   * @param serviceEntry - The service to register in the container.
   * @return Current instance of Alepha.
   */
  public with<T extends object>(
    serviceEntry: ServiceEntry<T> | { default: ServiceEntry<T> },
  ): this {
    const entry: ServiceEntry<T> =
      "default" in serviceEntry ? serviceEntry.default : serviceEntry;

    // just check if the entry is not present in the pending instantiation stack
    // Alepha#get will handle the rest
    if (
      this.has(entry, {
        inSubstitutions: false,
        inRegistry: false,
      })
    ) {
      return this;
    }

    const isSubstitution = typeof entry === "object";
    if (isSubstitution) {
      if (!this.substitutions.has(entry.provide) && !this.has(entry.provide)) {
        if (this.started) {
          throw new ContainerLockedError();
        }

        // inherit of module, if service has no module
        if (
          MODULE in entry.provide &&
          typeof entry.provide[MODULE] === "function"
        ) {
          (entry.use as WithModule)[MODULE] ??= entry.provide[MODULE];
        }

        this.substitutions.set(entry.provide, {
          use: entry.use,
        });
      } else if (!entry.optional) {
        throw new TooLateSubstitutionError(entry.provide.name, entry.use.name);
      }
      return this;
    }

    this.inject(entry);

    return this;
  }

  /**
   * Get an instance of the specified service from the container.
   *
   * @see {@link InjectOptions} for the available options.
   */
  public inject<T extends object>(
    service: Service<T>,
    opts: InjectOptions<T> = {},
  ): T {
    const lifetime = opts.lifetime ?? "singleton";
    const parent =
      opts.parent !== undefined ? opts.parent : (__alephaRef?.parent ?? Alepha);

    const transient = lifetime === "transient";
    const registry =
      lifetime === "scoped"
        ? (this.context.get<Map<Service, ServiceDefinition>>("registry") ??
          this.registry)
        : this.registry;

    // If the requested type is the container, the current instance is returned.
    if ((service as any) === Alepha) {
      return this as any;
    }

    const substitute = this.substitutions.get(service);
    if (substitute) {
      return this.inject(substitute.use, {
        parent,
        lifetime,
      });
    }

    const index = this.pendingInstantiations.indexOf(service);
    if (index !== -1 && !transient) {
      throw new CircularDependencyError(
        service.name,
        this.pendingInstantiations.slice(0, index).map((it) => it.name),
      );
    }

    if (!transient) {
      // the requested type is searched in the container
      const match = registry.get(service);
      if (match) {
        if (!match.parents.includes(parent) && parent !== service) {
          match.parents.push(parent);
        }

        return match.instance;
      }

      if (this.started) {
        throw new ContainerLockedError(
          `Container is locked. No more services can be added. ${parent?.name} -> ${service.name}`,
        );
      }
    }

    const module = (service as WithModule)[MODULE];
    if (module && typeof module === "function") {
      this.with(module);
    }

    // check if service has been registered by a module
    if (this.has(service, { registry }) && !transient) {
      // if the service is already registered, we just return the instance
      return this.inject(service, { parent, lifetime });
    }

    const instance: T = this.new(service, opts.args);

    const definition: ServiceDefinition<T> = {
      parents: [parent],
      instance,
    };

    if (!transient) {
      registry.set(service, definition);
    }

    // [feature]: modules - it's just a way to group services together
    if (instance instanceof Module) {
      this.modules.push(instance);

      const parent = __alephaRef.parent;

      // propagate the current module
      __alephaRef.parent = instance.constructor as Service;

      instance.register(this);

      // restore the previous $get context
      __alephaRef.parent = parent;
    }

    return instance;
  }

  // -------------------------------------------------------------------------------------------------------------------

  /**
   * Applies environment variables to the provided schema and state object.
   *
   * It replaces also all templated $ENV inside string values.
   *
   * @param schema - The schema object to apply environment variables to.
   * @return The schema object with environment variables applied.
   */
  public parseEnv<T extends TObject>(schema: T): Static<T> {
    if (this.cacheEnv.has(schema)) {
      return this.cacheEnv.get(schema) as Static<T>;
    }

    const config = this.codec.decode(schema, this.env) as Record<string, any>;

    for (const key in config) {
      if (typeof config[key] === "string") {
        for (const env in config) {
          config[key] = config[key].replace(
            new RegExp(`\\$${env}`, "gim"),
            config[env],
          );
        }
      }
    }

    this.cacheEnv.set(schema, config);

    return config as Static<T>;
  }

  // -------------------------------------------------------------------------------------------------------------------

  /**
   * Dump the current dependency graph of the App.
   *
   * This method returns a record where the keys are the names of the services.
   */
  public graph(): Record<
    string,
    { from: string[]; as?: string[]; module?: string }
  > {
    for (const [key] of this.substitutions.entries()) {
      if (!this.has(key)) {
        this.inject(key);
      }
    }

    const graph: Record<
      string,
      { from: string[]; as?: string[]; module?: string }
    > = {};

    for (const [provide, { parents }] of this.registry.entries()) {
      graph[provide.name] = {
        from: parents.filter((it) => !!it).map((it) => it.name),
      };

      const aliases = this.substitutions
        .entries()
        .filter((it) => it[1].use === provide)
        .map((it) => it[0].name)
        .toArray();

      if (aliases.length) {
        graph[provide.name].as = aliases;
      }

      const module = Module.of(provide);
      if (module) {
        graph[provide.name].module = module.name;
      }
    }

    return graph;
  }

  public services<T extends object>(base: Service<T>): Array<T> {
    const list: Array<T> = [];
    for (const [key, value] of this.registry.entries()) {
      if (value.instance instanceof base) {
        list.push(value.instance as T);
      }
    }
    return list;
  }

  /**
   * Get all descriptors of the specified type.
   */
  public descriptors<TDescriptor extends Descriptor>(
    factory:
      | {
          [KIND]: InstantiableClass<TDescriptor>;
        }
      | string,
  ): Array<TDescriptor> {
    if (typeof factory === "string") {
      const key1 = factory.toLowerCase().replace("$", "");
      const key2 = `${key1}descriptor`;
      for (const [key, value] of this.descriptorRegistry.entries()) {
        const name = key.name.toLowerCase();
        if (name === key1 || name === key2) {
          return value as Array<TDescriptor>;
        }
      }
      return [];
    }
    return (this.descriptorRegistry.get(factory[KIND]) ??
      []) as Array<TDescriptor>;
  }

  // -------------------------------------------------------------------------------------------------------------------

  protected new<T extends object>(service: Service<T>, args: any[] = []): T {
    // we keep a tree of dependencies to detect circular dependencies
    // it's also useful for cleaning are global cursor
    this.pendingInstantiations.push(service);

    //
    // we use a global cursor to store the current context and definition
    // as new() is synchronous, there is no worry to do that
    //
    __alephaRef.alepha = this;
    __alephaRef.service = service;

    const instance: T = isClass(service)
      ? new service(...args)
      : (((service as RunFunction)(...args) ?? {}) as T);

    const obj = instance as unknown as Record<string, any>;
    for (const [key, value] of Object.entries(obj)) {
      if (value instanceof Descriptor) {
        this.processDescriptor(value, key);
      }
      if (
        typeof value === "object" &&
        value !== null &&
        typeof value[OPTIONS] === "object" &&
        "getter" in value[OPTIONS]
      ) {
        Object.defineProperty(obj, key, {
          get: () => {
            return this.state.get(value[OPTIONS].getter);
          },
        });
      }
    }

    this.pendingInstantiations.pop();

    // tree is empty, now we can clean the global cursor
    if (this.pendingInstantiations.length === 0) {
      __alephaRef.alepha = undefined;
    }

    __alephaRef.service =
      this.pendingInstantiations[this.pendingInstantiations.length - 1];

    return instance;
  }

  protected processDescriptor(value: Descriptor, propertyKey = "") {
    value.config.propertyKey = propertyKey;
    (value as any).onInit();

    const kind = value.constructor as Service;
    const list = this.descriptorRegistry.get(kind) ?? [];
    this.descriptorRegistry.set(kind, [...list, value]);
  }
}

// ---------------------------------------------------------------------------------------------------------------------

export interface Hook<T extends keyof Hooks = any> {
  caller?: Service;
  priority?: "first" | "last";
  callback: (payload: Hooks[T]) => Async<void>;
}

// ---------------------------------------------------------------------------------------------------------------------

/**
 * This is how we store services in the Alepha container.
 */
interface ServiceDefinition<T extends object = any> {
  /**
   * The instance of the class or type definition.
   * Mostly used for caching / singleton but can be used for other purposes like forcing the instance.
   */
  instance: T;

  /**
   * List of classes which use this class.
   */
  parents: Array<Service | null>;
}

// ---------------------------------------------------------------------------------------------------------------------

export interface Env {
  [key: string]: string | boolean | number | undefined;

  /**
   * Optional environment variable that indicates the current environment.
   */
  NODE_ENV?: "dev" | "test" | "production";

  /**
   * Optional name of the application.
   */
  APP_NAME?: string;

  /**
   * Optional root module name.
   */
  MODULE_NAME?: string;
}

// ---------------------------------------------------------------------------------------------------------------------

export interface State {
  /**
   * Environment variables for the application.
   */
  env?: Readonly<Env>;

  /**
   * Logger instance to be used by the Alepha container.
   *
   * @internal
   */
  "alepha.logger"?: LoggerInterface;

  /**
   * If defined, the Alepha container will only register this service and its dependencies.
   */
  "alepha.target"?: Service;

  // test hooks

  /**
   * Bind to Vitest 'beforeAll' hook.
   * Used for testing purposes.
   * This is automatically attached if Alepha#create() detects a test environment and global 'beforeAll' is available.
   */
  "alepha.test.beforeAll"?: (run: any) => any;

  /**
   * Bind to Vitest 'afterAll' hook.
   * Used for testing purposes.
   * This is automatically attached if Alepha#create() detects a test environment and global 'afterAll' is available.
   */
  "alepha.test.afterAll"?: (run: any) => any;

  /**
   * Bind to Vitest 'afterEach' hook.
   * Used for testing purposes.
   * This is automatically attached if Alepha#create() detects a test environment and global 'afterEach' is available.
   */
  "alepha.test.afterEach"?: (run: any) => any;

  /**
   * Bind to Vitest 'onTestFinished' hook.
   * Used for testing purposes.
   * This is automatically attached if Alepha#create() detects a test environment and global 'onTestFinished' is available.
   */
  "alepha.test.onTestFinished"?: (run: any) => any;

  /**
   * List of static assets to be copied to the output directory during the build process.
   *
   * Used for Alepha-based applications that require static assets.
   *
   * See @alepha/vite for more details.
   */
  "alepha.build.assets"?: Array<string>;
}

// ---------------------------------------------------------------------------------------------------------------------

export interface Hooks {
  /**
   * Used for testing purposes.
   */
  echo: unknown;

  /**
   * Triggered during the configuration phase. Before the start phase.
   */
  configure: Alepha;

  /**
   * Triggered during the start phase. When `Alepha#start()` is called.
   */
  start: Alepha;

  /**
   * Triggered during the ready phase. After the start phase.
   */
  ready: Alepha;

  /**
   * Triggered during the stop phase.
   *
   * - Stop should be called after a SIGINT or SIGTERM signal in order to gracefully shutdown the application. (@see `run()` method)
   *
   */
  stop: Alepha;

  /**
   * Triggered when a state value is mutated.
   */
  "state:mutate": {
    /**
     * The key of the state that was mutated.
     */
    key: keyof State;

    /**
     * The new value of the state.
     */
    value: any;

    /**
     * The previous value of the state.
     */
    prevValue: any;
  };
}
