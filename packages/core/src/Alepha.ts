import type { Static, TObject, TSchema } from "@sinclair/typebox";
import type { TypeCheck } from "@sinclair/typebox/compiler";
import { TypeCompiler } from "@sinclair/typebox/compiler";
import { Value as v } from "@sinclair/typebox/value";
import { KIND } from "./constants/KIND.ts";
import { MODULE } from "./constants/MODULE.ts";
import { __alephaRef } from "./descriptors/$cursor.ts";
import type { InjectOptions } from "./descriptors/$inject.ts";
import { Module, type WithModule } from "./descriptors/$module.ts";
import { AlephaError } from "./errors/AlephaError.ts";
import { CircularDependencyError } from "./errors/CircularDependencyError.ts";
import { ContainerLockedError } from "./errors/ContainerLockedError.ts";
import { TypeBoxError } from "./errors/TypeBoxError.ts";
import { Descriptor } from "./helpers/descriptor.ts";
import type { Async } from "./interfaces/Async.ts";
import type { LoggerInterface } from "./interfaces/LoggerInterface.ts";
import type {
	InstantiableClass,
	Service,
	ServiceEntry,
} from "./interfaces/Service.ts";
import { AlsProvider } from "./providers/AlsProvider.ts";

/**
 * Core container of the Alepha framework.
 *
 * It is responsible for managing the lifecycle of services,
 * handling dependency injection,
 * and providing a unified interface for the application.
 *
 * @example
 * ```ts
 * import { Alepha, run } from "@alepha/core";
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
 *  	   MY_VAR: t.string(),
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
 * import { $module } from "@alepha/core";
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
 * import { $hook } from "@alepha/core";
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
 * 	 .then(alepha => alepha.emit("my:custom:hook"));
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
			const beforeAll = state.beforeAll ?? g.beforeAll;
			const afterAll = state.afterAll ?? g.afterAll;
			const afterEach = state.afterEach ?? g.afterEach;
			const onTestFinished = state.onTestFinished ?? g.onTestFinished;

			beforeAll?.(() => alepha.start());
			afterAll?.(() => alepha.stop());

			try {
				onTestFinished?.(() => alepha.stop());
			} catch (_error) {
				// ignore
			}

			alepha.state("beforeAll", beforeAll);
			alepha.state("afterAll", afterAll);
			alepha.state("afterEach", afterEach);
			alepha.state("onTestFinished", onTestFinished);
		}

		return alepha;
	}

	/**
	 *  List of all services + how they are provided.
	 */
	protected registry: Map<Service, ServiceDefinition> = new Map();

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
	 * The current state of the App.
	 *
	 * It contains the environment variables, logger, and other state-related properties.
	 *
	 * You can declare your own state properties by extending the `State` interface.
	 *
	 * ```ts
	 * declare module "@alepha/core" {
	 *   interface State {
	 *     myCustomValue: string;
	 *   }
	 * }
	 * ```
	 *
	 * Same story for the `Env` interface.
	 * ```ts
	 * declare module "@alepha/core" {
	 *   interface Env {
	 *     readonly myCustomValue: string;
	 *   }
	 * }
	 * ```
	 *
	 * State values can be function or primitive values.
	 * However, all .env variables must serializable to JSON.
	 */
	protected store: State;

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
	 * Cache for TypeBox type checks.
	 * > It allows us to avoid compiling the same schema multiple times.
	 */
	protected cacheTypeCheck: Map<TSchema, TypeCheck<TSchema>> = new Map();

	/**
	 * List of events that can be triggered. Powered by $hook().
	 */
	protected events: Record<string, Array<Hook>> = {};

	/**
	 * List of modules that are registered in the container.
	 *
	 * Modules are used to group services and provide a way to register them in the container.
	 */
	protected modules: Array<Module> = [];

	protected substitutions = new Map<Service, { use: Service }>();

	protected configurations = new Map<Service, object>();

	protected descriptorRegistry = new Map<
		Service<Descriptor>,
		Array<Descriptor>
	>();

	/**
	 * Node.js feature that allows to store context across asynchronous calls.
	 *
	 * This is used for logging, tracing, and other context-related features.
	 *
	 * Mocked for browser environments.
	 */
	public readonly context: AlsProvider = new AlsProvider();

	/**
	 * Get logger instance.
	 */
	public get log(): LoggerInterface | undefined {
		return this.state("log");
	}

	/**
	 * The environment variables for the App.
	 */
	public get env(): Readonly<Env> {
		return this.store.env ?? {};
	}

	constructor(state: Partial<State> = {}) {
		this.store = state;
	}

	/**
	 * State accessor and mutator.
	 */
	public state<Key extends keyof State>(
		key: Key,
		value?: State[Key],
	): State[Key] {
		if (!this.isBrowser() && this.context.exists()) {
			if (value !== undefined) {
				this.context.set(key, value);
			}
			return this.context.get<State[Key]>(key) ?? this.store[key];
		}

		if (value !== undefined) {
			if (this.isReady()) {
				this.emit(
					"state:mutate",
					{
						key,
						value,
						prevValue: this.store[key],
					},
					{ catch: true },
				);
			}
			this.store[key] = value;
		}

		return this.store[key];
	}

	// -------------------------------------------------------------------------------------------------------------------

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
	 * Returns whether the App is running in a serverless environment.
	 *
	 * > Vite developer mode is also considered serverless.
	 */
	public isServerless(): boolean | "vite" | "vercel" {
		if (this.isBrowser()) {
			return false;
		}

		if (this.env.VERCEL_REGION || process.env.VERCEL_REGION) {
			return "vercel";
		}

		if (this.env.VITE_ALEPHA_DEV || process.env.VITE_ALEPHA_DEV) {
			return "vite";
		}

		return false;
	}

	/**
	 * Returns whether the App is in test mode. (Running in a test environment)
	 *
	 * > This is automatically set when running tests with Jest or Vitest.
	 */
	public isTest(): boolean {
		const env = this.env.NODE_ENV ?? process.env.NODE_ENV;
		return env === "test";
	}

	/**
	 * Returns whether the App is in production mode. (Running in a production environment)
	 *
	 * > This is automatically set by Vite or Vercel. However, you have to set it manually when running Docker apps.
	 */
	public isProduction(): boolean {
		const env = this.env.NODE_ENV ?? process.env.NODE_ENV;
		return env === "prod" || env === "production";
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

		this.starting = Promise.withResolvers();

		const now = Date.now();

		this.log?.info("Starting App...");

		for (const [key] of this.substitutions.entries()) {
			this.inject(key);
		}

		const target = this.state("target");
		if (target) {
			this.registry = new Map();
			this.descriptorRegistry = new Map();
			this.with(target);
		}

		this.locked = true;

		await this.emit("configure", this, { log: true });

		this.configured = true;

		await this.emit("start", this, { log: true });

		this.started = true;

		await this.emit("ready", this, { log: true });

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
		await this.emit("stop", this, { reverse: true, log: true });
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
		opts?: {
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
		},
		registry = this.registry,
	): boolean {
		if (entry === Alepha) {
			return true;
		}

		const { provide } =
			typeof entry === "object" && "provide" in entry
				? entry
				: { provide: entry };

		if (!opts || opts.inSubstitutions === true) {
			const substitute = this.substitutions.get(provide);
			if (substitute) {
				return true;
			}
		}

		if (!opts || opts.inRegistry === true) {
			const match = registry.get(provide);
			if (match) {
				return true;
			}
		}

		if (!opts || opts.inStack === true) {
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
		if (this.has(entry, { inStack: true })) {
			return this;
		}

		const isSubstitution = typeof entry === "object";
		if (isSubstitution) {
			if (!this.substitutions.has(entry.provide) && !this.has(entry.provide)) {
				// inherit of module, if service has no module
				if (
					MODULE in entry.provide &&
					typeof entry.provide[MODULE] === "function"
				) {
					(entry.use as WithModule)[MODULE] ??= entry.provide[MODULE];
				}

				if (this.started) {
					throw new ContainerLockedError();
				}

				this.substitutions.set(entry.provide, {
					use: entry.use,
				});
			} else if (!entry.optional) {
				throw new AlephaError(
					`Service already substituted. Please, substitute Service '${entry.provide.name}' with Service '${entry.use.name}' before using it.`,
				);
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
		const parent =
			opts.parent !== undefined ? opts.parent : (__alephaRef?.parent ?? Alepha);

		const transient = opts.lifetime === "transient";
		const registry =
			opts.lifetime === "scoped"
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
			});
		}

		const index = this.pendingInstantiations.indexOf(service);
		if (index !== -1 && !transient) {
			throw new CircularDependencyError(
				service.name,
				this.pendingInstantiations.slice(0, index).map((it) => it.name),
			);
		}

		// the requested type is searched in the container
		const match = registry.get(service);

		// [feature]: dev mode - "hot reload" with Vite, not sure if it's a good idea
		if (!match && this.isServerless() === "vite" && !transient) {
			for (const [_, definition] of registry.entries()) {
				if (definition.instance?.constructor.name === service.name) {
					this.log?.debug(`Hot reload detected for ${service.name}`);
					const instance: T = this.new(service, opts.args);
					definition.instance = instance;
					return instance;
				}
			}
		}

		if (match && !transient) {
			if (!match.parents.includes(parent) && parent !== service) {
				match.parents.push(parent);
			}

			if (match.instance === undefined) {
				throw new Error("Should not happen: instance is undefined");
				// match.instance = this.new(match.use ?? match.provide, opts.args);
			}

			return match.instance;
		}

		if (this.started && !transient) {
			throw new ContainerLockedError(
				`Container is locked. No more services can be added. ${parent?.name} -> ${service.name}`,
			);
		}

		const module = (service as WithModule)[MODULE];
		if (module && typeof module === "function") {
			this.with(module);
		}

		// check if service has been registered by a module
		if (this.has(service, {}, registry) && !transient) {
			// if the service is already registered, we just return the instance
			return this.inject(service);
		}

		const instance: T = this.new(service, opts.args);

		// [feature]: configurations - update .options: object of the service instance
		const configuration = this.configurations.get(service);
		if (
			configuration &&
			"options" in instance &&
			instance.options &&
			typeof instance.options === "object"
		) {
			Object.assign(instance.options, configuration);
		}

		const definition: ServiceDefinition<T> = {
			module: typeof module === "function" ? module : undefined,
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

	/**
	 * Configures the specified service with the provided state.
	 * If service is not registered, it will do nothing.
	 *
	 * It's recommended to use this method on the `configure` hook.
	 * @example
	 * ```ts
	 * class AppConfig {
	 *   configure = $hook({
	 *     name: "configure",
	 *     handler: (a) => {
	 *       a.configure(MyProvider, { some: "data" });
	 *     }
	 *   })
	 * }
	 * ```
	 */
	public configure<T extends { options: object }>(
		service: Service<T>,
		state: Partial<T["options"]>,
	): this {
		if (this.has(service)) {
			Object.assign(this.inject(service).options, state);
		} else {
			this.configurations.set(service, state);
		}

		return this;
	}

	// -------------------------------------------------------------------------------------------------------------------

	// public use<T extends Descriptor>(
	// 	factory: () => T,
	// 	context: {
	// 		propertyKey?: string;
	// 		service?: Service;
	// 		module?: Module;
	// 	} = {},
	// ): T {
	// 	if (this.isLocked()) {
	// 		throw new ContainerLockedError(
	// 			`Container is locked. No more descriptors can be added.`,
	// 		);
	// 	}
	//
	// 	const outside = !__alephaRef.context;
	// 	if (outside) {
	// 		__alephaRef.context = this;
	// 		__alephaRef.definition = context.service;
	// 		__alephaRef.module =
	// 			this.modules.find((it) => it.$name === context?.module?.name) ??
	// 			(context.service
	// 				? this.registry.get(context.service)?.module
	// 				: undefined);
	// 	}
	//
	// 	const value = factory();
	// 	if (value instanceof Descriptor) {
	// 		this.processDescriptor(value, context.propertyKey);
	// 	}
	//
	// 	if (outside) {
	// 		__alephaRef.context = undefined;
	// 		__alephaRef.definition = undefined;
	// 		__alephaRef.module = undefined;
	// 	}
	//
	// 	return value as T;
	// }

	// -------------------------------------------------------------------------------------------------------------------

	/**
	 * Registers a hook for the specified event.
	 */
	public on<T extends keyof Hooks>(
		event: T,
		hookOrFunc: Hook<T> | ((payload: Hooks[T]) => Async<void>),
	): () => void {
		if (!this.events[event]) {
			this.events[event] = [];
		}

		const hook =
			typeof hookOrFunc === "function" ? { callback: hookOrFunc } : hookOrFunc;

		if (hook.priority === "first") {
			this.events[event].unshift(hook);
		} else if (hook.priority === "last") {
			this.events[event].push(hook);
		} else {
			const index = this.events[event].findIndex(
				(it) => it.priority === "last",
			);
			if (index !== -1) {
				this.events[event].splice(index, 0, hook);
			} else {
				this.events[event].push(hook);
			}
		}

		return () => {
			this.events[event] = this.events[event].filter(
				(it) => it.callback !== hook.callback,
			);
		};
	}

	/**
	 * Emits the specified event with the given payload.
	 */
	public async emit<T extends keyof Hooks>(
		func: keyof Hooks,
		payload: Hooks[T],
		options: {
			/**
			 * If true, the hooks will be executed in reverse order.
			 * This is useful for "stop" hooks that should be executed in reverse order.
			 *
			 * @default false
			 */
			reverse?: boolean;
			/**
			 * If true, the hooks will be logged with their execution time.
			 *
			 * @default false
			 */
			log?: boolean;
			/**
			 * If true, errors will be caught and logged instead of throwing.
			 *
			 * @default false
			 */
			catch?: boolean;
		} = {},
	): Promise<void> {
		const ctx: any = {};

		if (options.log) {
			ctx.now = Date.now();
			this.log?.trace(`${func} ...`);
		}

		let events = this.events[func] ?? [];

		if (options.reverse) {
			events = events.toReversed();
		}

		for (const hook of events) {
			const name = hook.caller?.name ?? "unknown";
			if (options.log) {
				ctx.now2 = Date.now();
				this.log?.trace(`${func}(${name}) ...`);
			}

			try {
				await hook.callback(payload);
			} catch (error) {
				if (options.catch) {
					this.log?.error(`${func}(${name}) ERROR`, error);
					continue;
				}
				if (options.log) {
					throw new AlephaError(
						`Failed during '${func}()' hook for service: ${name}`,
						{ cause: error },
					);
				}
				throw error;
			}

			if (options.log) {
				this.log?.debug(`${func}(${name}) OK [${Date.now() - ctx.now2}ms]`);
			}
		}

		if (options.log) {
			this.log?.debug(`${func} OK [${Date.now() - ctx.now}ms]`);
		}
	}

	// -------------------------------------------------------------------------------------------------------------------

	/**
	 * Casts the given value to the specified schema.
	 *
	 * It uses the TypeBox library to validate the value against the schema.
	 */
	public parse<T extends TSchema>(
		schema: T,
		value?: any,
		opts: {
			/**
			 * Clone the value before parsing.
			 * @default true
			 */
			clone?: boolean;
			/**
			 * Apply default values defined in the schema.
			 * @default true
			 */
			default?: boolean;
			/**
			 * Remove all values not defined in the schema.
			 * @default true
			 */
			clean?: boolean;
			/**
			 * Try to cast/convert some data based on the schema.
			 * @default true
			 */
			convert?: boolean;
			/**
			 * Prepare value after being deserialized.
			 * @default true
			 */
			check?: boolean;
		} = {},
	): Static<T> {
		const exists = this.cacheTypeCheck.get(schema);
		const check = exists ?? TypeCompiler.Compile(schema);
		if (!exists) {
			this.cacheTypeCheck.set(schema, check);
		}

		const actions = [];

		if (opts.clean !== false) {
			actions.push(v.Clean);

			for (const key in value) {
				if (value[key] === undefined) {
					delete value[key];
				}
			}
		}

		if (opts.default !== false) {
			actions.push(v.Default);
		}

		if (opts.convert !== false) {
			actions.push(v.Convert);
		}

		let alreadyParsed = false;
		if (
			(schema.type === "object" || schema.type === "array") &&
			typeof value === "string"
		) {
			try {
				value = JSON.parse(value);
				alreadyParsed = true;
			} catch (_error) {
				// ignore json parsing and let typebox handle it
			}
		}

		const copy =
			typeof value === "object" && opts.clone !== false && !alreadyParsed
				? // we clone simple objects to avoid mutation - most of the time...
					// -> Why not using structuredClone()?
					// "structuredClone()" will fail when the object contains functions to remove - which is the case for some internal projects.
					// so, keep using JSON.stringify/parse or make an option to use structuredClone
					// > it's kinda slow for huge JSON objects, but it's a trade-off
					JSON.parse(JSON.stringify(value))
				: value;

		const data = actions.reduce((acc, fn) => fn(schema, acc), copy);

		if (opts.check !== false) {
			const valid = check.Check(data);
			if (!valid) {
				const error = check.Errors(data).First();
				if (error) {
					throw new TypeBoxError(error);
				}
			}
		}

		return data;
	}

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

		const config = this.parse(schema, this.env) as Record<string, any>;

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

		return config;
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

		for (const [provide, { parents, module }] of this.registry.entries()) {
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
			if (module?.name) {
				graph[provide.name].module = module.name;
			}
		}

		return graph;
	}

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
		__alephaRef.context = this;
		__alephaRef.definition = service;

		const instance: T = new (service as InstantiableClass<any>)(...args);

		const obj = instance as unknown as Record<string, any>;
		for (const [key, value] of Object.entries(obj)) {
			if (value instanceof Descriptor) {
				this.processDescriptor(value, key);
			}
		}

		this.pendingInstantiations.pop();

		// tree is empty, now we can clean the global cursor
		if (this.pendingInstantiations.length === 0) {
			__alephaRef.context = undefined;
		}

		__alephaRef.definition =
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

	/**
	 * If the service is provided by a module, the module definition.
	 */
	module?: Service;
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
	log?: LoggerInterface;
	env?: Readonly<Env>;

	/**
	 * If defined, the Alepha container will only register this service and its dependencies.
	 */
	target?: Service;

	// test hooks
	beforeAll?: (run: any) => any;
	afterAll?: (run: any) => any;
	afterEach?: (run: any) => any;
	onTestFinished?: (run: any) => any;
}

// ---------------------------------------------------------------------------------------------------------------------

export interface Hooks {
	echo: any; // for testing purposes

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
