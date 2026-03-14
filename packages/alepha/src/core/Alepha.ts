import type { Record, Static, TObject } from "typebox";
import { KIND } from "./constants/KIND.ts";
import { MODULE } from "./constants/MODULE.ts";
import { OPTIONS } from "./constants/OPTIONS.ts";
import { AlephaError } from "./errors/AlephaError.ts";
import { CircularDependencyError } from "./errors/CircularDependencyError.ts";
import { ContainerLockedError } from "./errors/ContainerLockedError.ts";
import { TooLateSubstitutionError } from "./errors/TooLateSubstitutionError.ts";
import { Primitive } from "./helpers/primitive.ts";
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
import type { Atom, AtomStatic, TAtomObject } from "./primitives/$atom.ts";
import type { InjectOptions } from "./primitives/$inject.ts";
import { Module, type WithModule } from "./primitives/$module.ts";
import { AlsProvider, type StateScope } from "./providers/AlsProvider.ts";
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
 * // But you should use $env() primitive to get typed values from the environment.
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
 * You can register a module using the `$module` primitive.
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
 * You can register a hook using the `$hook` primitive.
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
        ...process.env,
        ...state.env,
      };
    }

    // force production mode when building with vite
    if (typeof process === "object" && process.env?.NODE_ENV === "production") {
      state.env ??= {};
      Object.assign(state.env, {
        NODE_ENV: "production",
      });
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

      alepha.store
        .set("alepha.test.beforeAll", beforeAll)
        .set("alepha.test.afterAll", afterAll)
        .set("alepha.test.afterEach", afterEach)
        .set("alepha.test.onTestFinished", onTestFinished);
    } else {
      state["alepha.logger"] ??= {
        trace: console.log,
        debug: console.debug,
        info: console.log,
        warn: console.warn,
        error: console.error,
      };
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
   * In-flight startup promise returned by boot().
   *
   * Concurrent callers of start() share this same promise. Cleared on
   * success, failure, or stale-detection.
   */
  protected startPromise?: Promise<this>;

  /**
   * Timestamp (performance.now) when the current boot() began.
   *
   * In serverless environments (e.g. Cloudflare Workers), the runtime can
   * kill an invocation mid-startup without running cleanup. The global
   * Alepha instance persists, leaving startPromise as a never-settling
   * promise. We detect this by comparing elapsed time against STARTUP_TIMEOUT.
   */
  protected startedAt = 0;

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
   * Registry of primitives.
   */
  protected primitiveRegistry = new Map<Service<Primitive>, Array<Primitive>>();

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
  public context: AlsProvider;

  /**
   * Event manager to handle lifecycle events and custom events.
   */
  public events: EventManager;

  /**
   * State manager to store arbitrary values.
   */
  public store: StateManager<State>;

  /**
   * Codec manager for encoding and decoding data with different formats.
   *
   * Supports multiple codec formats (JSON, Protobuf, etc.) with a unified interface.
   */
  public codec: CodecManager;

  /**
   * Get logger instance.
   */
  public get log(): LoggerInterface | undefined {
    return this.store.get("alepha.logger");
  }

  /**
   * The environment variables for the App.
   */
  public get env(): Readonly<Env> {
    return this.store.get("env") ?? {};
  }

  constructor(state: Partial<State> = {}) {
    this.store = this.inject(StateManager, {
      args: [state],
    });
    this.events = this.inject(EventManager);
    this.events.logFn = () => this.log;
    this.context = this.inject(AlsProvider);
    this.codec = this.inject(CodecManager);
  }

  public fork<R>(callback: () => R, data: Record<string, any> = {}): R {
    return this.context.run(callback, data);
  }

  public get<T extends TAtomObject>(
    target: Atom<T>,
    scope?: StateScope,
  ): Static<T>;
  public get<Key extends keyof State>(
    target: Key,
    scope?: StateScope,
  ): State[Key] | undefined;
  public get(target: any, scope?: StateScope): any {
    return this.store.get(target, scope);
  }

  public set<T extends TAtomObject>(
    target: Atom<T>,
    value: AtomStatic<T>,
  ): this;
  public set<Key extends keyof State>(
    target: Key,
    value: State[Key] | undefined,
  ): this;
  public set(target: any, value: any): this {
    this.store.set(target, value);
    return this;
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
   * True if the App is running in a Continuous Integration environment.
   */
  public isCI(): boolean {
    if (this.env.GITHUB_ACTIONS) {
      return true;
    }

    return !!this.env.CI;
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
   * Returns whether the App is running in Bun.js environment.
   */
  public isBun(): boolean {
    return "Bun" in globalThis;
  }

  /**
   * Returns whether the App is running in a serverless environment.
   */
  public isServerless(): boolean {
    if (this.isBrowser()) {
      return false;
    }

    if (this.env.ALEPHA_SERVERLESS) {
      return true;
    }

    // Vercel support
    if (this.env.VERCEL_REGION) {
      return true;
    }

    // Cloudflare Workers support
    if (
      typeof global === "object" &&
      typeof (global as any).Cloudflare === "object"
    ) {
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
   * Max time (ms) a boot() is allowed to run before being considered stale.
   *
   * In serverless runtimes (Cloudflare Workers, etc.) an invocation can be
   * killed mid-startup. The global Alepha instance survives, but
   * `startPromise` becomes a zombie that never settles.
   * Any new invocation that sees an older-than-STARTUP_TIMEOUT promise
   * discards it and boots fresh.
   */
  protected static readonly STARTUP_TIMEOUT = 30_000;

  /**
   * Starts the App.
   *
   * - Lock any further changes to the container.
   * - Run "configure" hook for all services. Primitives will be processed.
   * - Run "start" hook for all services. Providers will connect/listen/...
   * - Run "ready" hook for all services. This is the point where the App is ready to serve requests.
   *
   * Concurrent callers share the same boot promise. If a previous boot was
   * abandoned (serverless invocation killed), the stale promise is detected
   * and a fresh boot is triggered.
   *
   * @return A promise that resolves when the App has started.
   */
  public async start(): Promise<this> {
    if (this.ready) {
      this.log?.debug("App is already started, skipping...");
      return this;
    }

    if (this.startPromise) {
      const elapsed = performance.now() - this.startedAt;
      if (elapsed > Alepha.STARTUP_TIMEOUT) {
        this.log?.warn(
          `Previous start attempt is stale (${Math.round(elapsed)}ms ago), resetting...`,
        );
        this.resetStartup();
      } else {
        this.log?.warn("App is already starting, waiting for it to finish...");
        return this.startPromise;
      }
    }

    this.startedAt = performance.now();
    this.startPromise = this.boot();
    return this.startPromise;
  }

  /**
   * Perform the actual startup sequence.
   *
   * Separated from start() so that start() remains a thin state-machine
   * and boot() owns the real work. The promise returned here is stored as
   * `startPromise` and shared with concurrent callers.
   */
  protected async boot(): Promise<this> {
    const now = performance.now();
    this.log?.info("Starting App...");

    try {
      for (const [key] of this.substitutions.entries()) {
        this.inject(key);
      }

      const target = this.store.get("alepha.target");
      if (target) {
        this.store.set("alepha.target", undefined);
        this.modules = [];
        this.registry = new Map();
        this.primitiveRegistry = new Map();
        this.pendingInstantiations = [];
        this.events.clear();
        delete (target as any)[MODULE];
        this.with(target);
        for (const [key] of this.substitutions.entries()) {
          this.inject(key);
        }
      }

      this.locked = true;

      await this.events.emit("configure", this, { log: true });

      this.configured = true;

      await this.events.emit("start", this, { log: true });

      this.started = true;

      await this.events.emit("ready", this, { log: true });

      this.log?.info(
        `App is now ready [${Math.round(performance.now() - now)}ms]`,
      );

      this.ready = true;
      return this;
    } catch (error) {
      this.resetStartup();
      throw error;
    }
  }

  /**
   * Reset startup state so that a fresh boot() can be attempted.
   *
   * Called when:
   * - boot() fails (error during configure/start/ready hooks)
   * - a stale startPromise is detected (serverless invocation was killed)
   */
  protected resetStartup(): void {
    this.startPromise = undefined;
    this.startedAt = 0;
    this.locked = false;
    this.configured = false;
    this.started = false;
    this.ready = false;
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
    await this.events.emit("stop", this, { log: true });
    this.log?.info("App is now off");

    this.started = false;
    this.ready = false;
    this.startPromise = undefined;
    this.startedAt = 0;
  }

  /**
   * Destroys the App and clears all internal state.
   *
   * Use this for HMR in development mode to prevent duplicate class registrations.
   * Unlike stop(), this method fully resets the container state.
   *
   * @return A promise that resolves when the App has been destroyed.
   */
  public async destroy(): Promise<void> {
    await this.stop();

    // Clear all internal state to prevent duplicate classes on HMR reload
    this.modules = [];
    this.registry = new Map();
    this.primitiveRegistry = new Map();
    this.pendingInstantiations = [];
    this.substitutions = new Map();
    this.cacheEnv = new Map();
    this.events.clear();

    // Reset flags
    this.locked = false;
    this.configured = false;
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
    // Early cutoff: if a $mode already claimed the target, skip further registrations.
    // The target's own dependencies are resolved via $inject during its constructor.
    if (this.store?.get("alepha.target")) {
      return this;
    }

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
      if (entry.provide === entry.use) {
        this.inject(entry.provide);
        return this;
      }

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
    service: Service<T> | string,
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

    if (typeof service === "string") {
      for (const [key, value] of registry.entries()) {
        if (key.name === service) {
          return value.instance as T;
        }
      }
      throw new AlephaError(`Service not found: ${service}`);
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
        const mod = (service as WithModule)[MODULE]?.name;
        throw new ContainerLockedError(
          `Container is locked. No more services can be added. Attempted to inject '${service.name}' from '${parent?.name}'. ${mod ? `Module '${mod}' is not registered ?` : ""}`,
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

    const config = this.codec.validate(schema, this.env) as Record<string, any>;

    // Sort keys longest-first to prevent substring collisions
    // (e.g. $PORT must not match inside $PORT_NAME).
    const sortedKeys = Object.keys(config).sort((a, b) => b.length - a.length);

    let changed = true;

    // Resolve $KEY references. Multiple passes handle transitive references
    // where a replacement introduces a new $KEY that was already checked
    // (e.g. C=$B, B=$A, A=value — single pass leaves C as "$A").

    for (let pass = 0; changed && pass < 10; pass++) {
      changed = false;
      for (const key in config) {
        if (typeof config[key] !== "string") continue;
        for (const env of sortedKeys) {
          const before = config[key] as string;
          config[key] = before.replaceAll(`$${env}`, String(config[env] ?? ""));
          if (config[key] !== before) {
            changed = true;
          }
        }
      }
    }

    this.cacheEnv.set(schema, config);

    return config as Static<T>;
  }

  /**
   * Get all environment variable schemas and their parsed values.
   *
   * This is useful for DevTools to display all expected environment variables.
   */
  public getEnvSchemas(): Array<{
    schema: TSchema;
    values: Record<string, any>;
  }> {
    const result: Array<{ schema: TSchema; values: Record<string, any> }> = [];
    for (const [schema, values] of this.cacheEnv.entries()) {
      result.push({ schema, values });
    }
    return result;
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
      if (provide.name === "") {
        // ignore anonymous classes
        continue;
      }

      if (Module.is(provide)) {
        continue;
      }

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

  public dump(): AlephaDump {
    const env: Record<string, AlephaDumpEnvVariable> = {};
    for (const [schema] of this.cacheEnv.entries()) {
      const ref = schema as any;
      for (const [key, value] of Object.entries(ref.properties)) {
        const prop = value as any;
        env[key] = {
          description: prop.description,
          default: prop.default,
          required: ref.required?.includes(key) ?? undefined,
          enum: prop.enum ? ([...prop.enum] as Array<string>) : undefined,
        };
      }
    }

    return {
      env,
      providers: this.graph(),
    };
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
   * Get all primitives of the specified type.
   */
  public primitives<TPrimitive extends Primitive>(
    factory:
      | {
          [KIND]: InstantiableClass<TPrimitive>;
        }
      | string,
  ): Array<TPrimitive> {
    if (typeof factory === "string") {
      const key1 = factory.toLowerCase().replace("$", "");
      const key2 = `${key1}primitive`;
      for (const [key, value] of this.primitiveRegistry.entries()) {
        const name = key.name.toLowerCase();
        if (name === key1 || name === key2) {
          return value as Array<TPrimitive>;
        }
      }
      return [];
    }
    return (this.primitiveRegistry.get(factory[KIND]) ??
      []) as Array<TPrimitive>;
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
      if (value instanceof Primitive) {
        this.processPrimitive(value, key);
      }
      if (
        typeof value === "object" &&
        value !== null &&
        typeof value[OPTIONS] === "object" &&
        "getter" in value[OPTIONS]
      ) {
        const getter = value[OPTIONS].getter as keyof State;
        Object.defineProperty(obj, key, {
          get: () => this.store.get(getter),
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

  protected processPrimitive(value: Primitive, propertyKey = "") {
    value.config.propertyKey = propertyKey;
    (value as any).onInit();

    const kind = value.constructor as Service;
    const existing = this.primitiveRegistry.get(kind);
    if (existing) {
      existing.push(value);
    } else {
      this.primitiveRegistry.set(kind, [value]);
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------------

export interface Hook<T extends keyof Hooks = any> {
  caller?: Service;
  priority?: "first" | "last";
  before?: Service[];
  after?: Service[];
  callback: (payload: Hooks[T]) => Async<void>;
}

// ---------------------------------------------------------------------------------------------------------------------

export interface AlephaDump {
  env: Record<string, AlephaDumpEnvVariable>;
  providers: Record<string, { from: string[]; as?: string[]; module?: string }>;
}

export interface AlephaDumpEnvVariable {
  description: string;
  default?: string;
  required?: boolean;
  enum?: Array<string>;
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
  NODE_ENV?: string;

  /**
   * Optional name of the application.
   */
  APP_NAME?: string;

  /**
   * Optional root module name.
   */
  MODULE_NAME?: string;

  /**
   * The secret key used for signing JWTs, encrypting cookies, and other security features.
   */
  APP_SECRET?: string;
}

// ---------------------------------------------------------------------------------------------------------------------

export interface State {
  [key: string]: unknown;

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
   *
   * @example
   * ```ts
   * class MigrateCmd {
   *   db = $inject(DatabaseProvider);
   *   alepha = $inject(Alepha);
   *   env = $env(
   *     t.object({
   *       MIGRATE: t.optional(t.boolean()),
   *     }),
   *   );
   *
   *   constructor() {
   *     if (this.env.MIGRATE) {
   *       this.alepha.set("alepha.target", MigrateCmd);
   *     }
   *   }
   *
   *   ready = $hook({
   *     on: "ready",
   *     handler: async () => {
   *       if (this.env.MIGRATE) {
   *         await this.db.migrate();
   *       }
   *     },
   *   });
   * }
   * ```
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
   * See cli/services/ViteUtils for more details.
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
