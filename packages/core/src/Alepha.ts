import type { Static, TObject, TSchema } from "@sinclair/typebox";
import type { TypeCheck } from "@sinclair/typebox/compiler";
import { TypeCompiler } from "@sinclair/typebox/compiler";
import { Value as v } from "@sinclair/typebox/value";
import { KIND } from "./constants/KIND.ts";
import { __alephaRef } from "./descriptors/$cursor.ts";
import type { Hook } from "./descriptors/$hook.ts";
import { AlephaError } from "./errors/AlephaError.ts";
import { CircularDependencyError } from "./errors/CircularDependencyError.ts";
import { ContainerLockedError } from "./errors/ContainerLockedError.ts";
import { TypeBoxError } from "./errors/TypeBoxError.ts";
import type { Descriptor, DescriptorItem } from "./helpers/descriptor.ts";
import { isDescriptorValue } from "./helpers/descriptor.ts";
import {
	isModule,
	type Module,
	type ModuleDefinition,
	toModuleName,
} from "./helpers/Module.ts";
import type { Async } from "./interfaces/Async.ts";
import type {
	InstantiableService,
	Service,
	ServiceEntry,
} from "./interfaces/Service.ts";
import { AlsProvider } from "./providers/AlsProvider.ts";
import { Logger, type LoggerEnv } from "./services/Logger.ts";

// ---------------------------------------------------------------------------------------------------------------------

export interface Env extends LoggerEnv {
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
	 * If true, the container will not automatically register the default providers based on the descriptors.
	 *
	 * It means that you have to alepha.with(ServiceModule) manually. No magic.
	 *
	 * @default false
	 */
	EXPLICIT_PROVIDERS?: boolean;
}

// ---------------------------------------------------------------------------------------------------------------------

export interface State {
	log: Logger;
	env?: Readonly<Env>;

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

// ---------------------------------------------------------------------------------------------------------------------

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
 * > Some alepha methods are not intended to be used directly, use descriptors instead.
 *
 * - $hook -> alepha.on()
 * - $inject -> alepha.get(), alepha.parseEnv()
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
	protected modules: Array<ModuleDefinition> = [];

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
	public get log(): Logger {
		return this.store.log;
	}

	/**
	 * The environment variables for the App.
	 */
	public get env(): Readonly<Env> {
		return this.store?.env ?? {};
	}

	constructor(state: Partial<State> = {}) {
		const env = state.env ?? {};
		const log = state.log ?? this.createLogger(env);
		this.store = {
			...state,
			env,
			log,
		};
	}

	/**
	 * Generic handle function used as generic interface for serverless functions.
	 * You should not use this property directly.
	 */
	public handle?: (req: any, res: any) => Promise<any>;

	/**
	 * State accessor and mutator.
	 */
	public state<Key extends keyof State>(
		key: Key,
		value?: State[Key],
	): State[Key] {
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

		if (process.env.VERCEL_REGION) {
			return "vercel";
		}

		if (process.env.VITE_ALEPHA_DEV || process.env.VITE_ALEPHA_BUILD) {
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
			return this;
		}

		// make sure that start is called only once
		if (this.starting) {
			return this.starting.promise;
		}

		this.starting = Promise.withResolvers();

		const now = Date.now();

		this.log.info("Starting App...");

		this.locked = true;

		await this.emit("configure", this, { log: true });

		this.configured = true;

		await this.emit("start", this, { log: true });

		this.started = true;

		await this.emit("ready", this, { log: true });

		this.log.info(`App is now ready [${Date.now() - now}ms]`);

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

		this.log.info("Stopping App...");
		await this.emit("stop", this, { reverse: true, log: true });
		this.log.info("App is now off");

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
			 * Default: true
			 */
			inStack?: boolean;
			/**
			 * Check if the entry is registered in the container registry.
			 *
			 * Default: true
			 */
			inRegistry?: boolean;
		},
	): boolean {
		if (entry === Alepha) {
			return true;
		}

		const { provide } =
			typeof entry === "object" && "provide" in entry
				? entry
				: { provide: entry };

		if (!opts || opts.inRegistry === true) {
			const match = this.registry.get(provide);
			if (match) {
				return true;
			}
		}

		if (!opts || opts.inStack === true) {
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
	 * @param entry - The service to register in the container.
	 * @return Current instance of Alepha.
	 */
	public with<T extends object>(entry: ServiceEntry<T>): this {
		if (this.started) {
			throw new ContainerLockedError();
		}

		// just check if the entry is not present in the pending instantiation stack
		// Alepha#get will handle the rest
		if (this.has(entry, { inStack: true })) {
			return this;
		}

		this.get(entry);

		return this;
	}

	/**
	 * Get the instance of the specified service and apply some changes, depending on the options.
	 * - If the service is already registered, it will return the existing instance. (except if `skipCache` is true)
	 * - If the service is not registered, it will create a new instance and register it. (except if `skipRegistration` is true)
	 * - New instance can be created with custom constructor arguments. (`args` option)
	 *
	 * > This method is used by $inject() under the hood.
	 *
	 * @return The instance of the specified class or type.
	 */
	public get<T extends object>(
		serviceEntry: ServiceEntry<T>,
		opts: {
			/**
			 * Ignore current existing instance.
			 */
			skipCache?: boolean;
			/**
			 * Don't store the instance in the registry.
			 */
			skipRegistration?: boolean;
			/**
			 * Constructor arguments to pass when creating a new instance.
			 */
			args?: ConstructorParameters<InstantiableService<T>>;
			/**
			 * Parent service that requested the instance.
			 * @internal
			 */
			parent?: Service | null;
			/**
			 * If the service is provided by a module, the module definition.
			 * @internal
			 */
			module?: ModuleDefinition;
		} = {},
	): T {
		const parent =
			opts.parent !== undefined
				? opts.parent
				: (__alephaRef.$services?.parent ?? Alepha);
		const module = opts.module ?? __alephaRef.$services?.module;

		// If the requested type is the container, the current instance is returned.
		if ((serviceEntry as any) === Alepha) {
			return this as any;
		}

		const definition =
			"provide" in serviceEntry ? serviceEntry : { provide: serviceEntry };

		const index = this.pendingInstantiations.indexOf(definition.provide);
		if (index !== -1) {
			throw new CircularDependencyError(
				definition.provide.name,
				this.pendingInstantiations.slice(0, index).map((it) => it.name),
			);
		}

		// the requested type is searched in the container
		const match = this.registry.get(definition.provide);

		if (match && !opts.skipCache) {
			if (
				"use" in definition &&
				definition.use &&
				match.use !== definition.use &&
				definition.optional !== true
			) {
				throw new AlephaError(
					`Late substitution is forbidden. Please, substitute Service '${match.provide.name}' with Service '${definition.use.name}' before using it.`,
				);
			}

			if (!match.parents.includes(parent)) {
				match.parents.push(parent);
			}

			if (match.instance === undefined) {
				match.instance = this.new(match.use ?? match.provide, opts.args);
			}

			return match.instance;
		}

		if (this.started) {
			throw new ContainerLockedError(
				`Container is locked. No more services can be added. ${parent?.name} -> ${definition.provide.name}`,
			);
		}

		const instance: T =
			"use" in definition && definition.use
				? this.get(definition.use, { parent: null, module })
				: this.new(definition.provide, opts.args, module);

		if (!opts.skipRegistration) {
			this.registry.set(definition.provide, {
				...definition,
				instance,
				parents: [parent],
				module,
			});
		}

		// [feature]: modules - it's just a way to group services together
		if (isModule(instance)) {
			const moduleDefinition: ModuleDefinition = {
				...instance,
				name: instance.name ?? toModuleName(instance.constructor.name),
				services: [],
			};

			this.modules.push(moduleDefinition);
			const definition = this.registry.get(instance.constructor as Service);
			if (definition) {
				definition.module = moduleDefinition;
			}

			const $services = __alephaRef.$services;

			// propagate the current module
			__alephaRef.$services = {
				module: moduleDefinition,
				parent: instance.constructor as Service,
			};

			instance.$services(this);

			// restore the previous $get context
			__alephaRef.$services = $services;
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
			Object.assign(this.get(service).options, state);
		} else {
			this.log.debug(
				`Service '${service.constructor.name}' not registered, skipping configuration`,
			);
		}
		return this;
	}

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
			this.log.trace(`${func} ...`);
		}

		let events = this.events[func] ?? [];

		if (options.reverse) {
			events = events.toReversed();
		}

		for (const hook of events) {
			const name = hook.caller?.name ?? "unknown";
			if (options.log) {
				ctx.now2 = Date.now();
				this.log.trace(`${func}(${name}) ...`);
			}

			if (options.catch) {
				try {
					await hook.callback(payload);
				} catch (error) {
					this.log.error(`${func}(${name}) ERROR`, error);
					continue;
				}
			} else {
				await hook.callback(payload);
			}

			if (options.log) {
				this.log.debug(`${func}(${name}) OK [${Date.now() - ctx.now2}ms]`);
			}
		}

		if (options.log) {
			this.log.debug(`${func} OK [${Date.now() - ctx.now}ms]`);
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
		{ from: string[]; as?: string; module?: string }
	> {
		const graph: Record<
			string,
			{ from: string[]; as?: string; module?: string }
		> = {};

		for (const { provide, parents, use, module } of this.registry.values()) {
			graph[provide.name] = {
				from: parents.filter((it) => !!it).map((it) => it.name),
			};
			if (use?.name) {
				graph[provide.name].as = use.name;
			}
			if (module?.name) {
				graph[provide.name].module = module.name;
			}
		}

		return graph;
	}

	// -------------------------------------------------------------------------------------------------------------------

	/**
	 * @internal
	 */
	public getDescriptorValues<T extends Descriptor>(
		descriptor: T,
	): Array<DescriptorItem<T>> {
		const items: Array<DescriptorItem<T>> = [];

		for (const { instance } of this.registry.values()) {
			if (instance) {
				for (const [key, value] of Object.entries(instance)) {
					if (isDescriptorValue(value) && value[KIND] === descriptor[KIND]) {
						// when class swap, instance can be referenced twice (provide: itself and provide: swapped)
						// -> we take instance only once to avoid duplicate descriptors
						if (
							items.find((it) => it.instance === instance && it.key === key)
						) {
							continue;
						}

						items.push({
							value: value as ReturnType<T>,
							key,
							instance,
						});
					}
				}
			}
		}

		return items;
	}

	/**
	 * @internal
	 */
	protected new<T extends object>(
		definition: Service<T>,
		args: any[] = [],
		module?: ModuleDefinition,
	): T {
		// we keep a tree of dependencies to detect circular dependencies
		// it's also useful for cleaning are global cursor
		this.pendingInstantiations.push(definition);

		//
		// we use a global cursor to store the current context and definition
		// as new() is synchronous, there is no worry to do that
		//
		const previousModule = __alephaRef.module;
		__alephaRef.context = this;
		__alephaRef.definition = definition;
		__alephaRef.module = module;

		if (typeof definition !== "function") {
			console.warn("definition is not a function", definition);
			return definition as T;
		}

		const instance: T = new (definition as InstantiableService<any>)(...args);

		const obj = instance as unknown as Record<string, any>;
		for (const key of Object.keys(obj)) {
			if (obj[key]?.[KIND] && obj[key].options) {
				obj[key].options.name ??= key;
			}
		}

		this.pendingInstantiations.pop();

		// tree is empty, now we can clean the global cursor
		if (this.pendingInstantiations.length === 0) {
			__alephaRef.context = undefined;
		}

		__alephaRef.definition =
			this.pendingInstantiations[this.pendingInstantiations.length - 1];
		__alephaRef.module = previousModule;

		return instance;
	}

	/**
	 * @internal
	 */
	protected createLogger(env: Env): Logger {
		return new Logger({
			als: this.context,
			level: env.LOG_LEVEL ?? (this.isTest() ? "silent" : "info"),
			name: "alepha.core",
			json: env.LOG_FORMAT
				? env.LOG_FORMAT === "json"
				: env.NODE_ENV === "production",
			caller: "Alepha",
			color:
				!env.NO_COLOR &&
				env.FORCE_COLOR !== "0" &&
				env.NODE_ENV !== "production",
		});
	}

	/**
	 * @internal
	 */
	public getModuleOf(service: Service): Module | undefined {
		for (const module of this.modules) {
			for (const it of module.services ?? []) {
				if (it === service) {
					return module;
				}
			}
		}
	}
}

// ---------------------------------------------------------------------------------------------------------------------

/**
 * This is how we store services in the Alepha container.
 */
interface ServiceDefinition<T extends object = any> {
	/**
	 * The class or type definition to provide.
	 */
	provide: Service<T>;

	/**
	 * The class or type definition to use. This will override the 'provide' property.
	 */
	use?: Service<T>;

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
	module?: ModuleDefinition;
}
