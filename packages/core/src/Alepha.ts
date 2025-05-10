import type { Record, Static, TObject, TSchema } from "@sinclair/typebox";
import type { TypeCheck } from "@sinclair/typebox/compiler";
import { TypeCompiler } from "@sinclair/typebox/compiler";
import { Value as v } from "@sinclair/typebox/value";
import { KIND } from "./constants/KIND.ts";
import { PROVIDER } from "./constants/PROVIDER.ts";
import { __alephaRef } from "./descriptors/$cursor.ts";
import type { Hook, Hooks } from "./descriptors/$hook.ts";
import { AppNotStartedError } from "./errors/AppNotStartedError.ts";
import { CircularDependencyError } from "./errors/CircularDependencyError.ts";
import { ContainerLockedError } from "./errors/ContainerLockedError.ts";
import { TypeBoxError } from "./errors/TypeBoxError.ts";
import type { Descriptor, DescriptorItem } from "./helpers/descriptor.ts";
import { isDescriptorValue } from "./helpers/descriptor.ts";
import type { Class, ClassEntry, ClassProvider } from "./interfaces/Class.ts";
import { AsyncLocalStorageProvider } from "./providers/AsyncLocalStorageProvider.ts";
import { Logger, type LoggerEnv } from "./services/Logger.ts";

export interface Env extends LoggerEnv {
	[key: string]: string | boolean | number | undefined;

	/**
	 *
	 */
	NODE_ENV?: "dev" | "test" | "production";

	/**
	 * Optional name of the application.
	 */
	APP_NAME?: string;

	/**
	 * If true, the container will not automatically register the default providers.
	 * Default is false.
	 */
	EXPLICIT_PROVIDERS?: boolean;
}

export interface State {
	log: Logger;
	env?: Readonly<Env>;

	// test hooks
	beforeAll?: (run: any) => any;
	afterAll?: (run: any) => any;
	afterEach?: (run: any) => any;
	onTestFinished?: (run: any) => any;
}

/**
 *
 *
 * @example
 * ```ts
 * const app = Alepha.create();
 * ```
 */
export class Alepha {
	/**
	 * Syntactic sugar for creating a new instance of the container.
	 * Equivalent to `Alepha.create()`.
	 */
	public static create(state: Partial<State> = {}): Alepha {
		const alepha = new Alepha(state);

		if (alepha.isTest()) {
			const g = globalThis as any;
			const beforeAll = state.beforeAll ?? g.beforeAll;
			const afterAll = state.afterAll ?? g.afterAll;
			const afterEach = state.afterEach ?? g.afterEach;
			const onTestFinished = state.onTestFinished ?? g.onTestFinished;

			beforeAll?.(() => alepha.start());
			afterAll?.(() => alepha.stop());

			try {
				onTestFinished?.(() => alepha.stop());
			} catch (error) {
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
	protected registry: Map<Class, ClassProvider> = new Map();

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
	 * The state of the App.
	 */
	protected _starting?: PromiseWithResolvers<this>;
	protected _state: State;
	protected _dependencyStack: Class[] = [];
	protected _lazyRegistrations: Array<Promise<{ default: Class<object> }>> = [];
	protected _cacheEnv = new Map<TSchema, any>();
	protected _cacheTypeCheck = new Map<TSchema, TypeCheck<TSchema>>();
	protected _events: Record<string, Array<Hook>> = {};

	public readonly als = new AsyncLocalStorageProvider();

	public get log(): Logger {
		return this._state.log;
	}

	public handle?: (req: any, res: any) => Promise<any>;

	/**
	 * The environment variables for the App.
	 */
	public get env(): Readonly<Env> {
		return this._state?.env ?? {};
	}

	constructor(state: Partial<State> = {}) {
		const env = state.env ?? {};
		const log = state.log ?? this.createLogger(env);
		this._state = {
			...state,
			env,
			log,
		};
	}

	/**
	 * State accessor.
	 */
	public state<Key extends keyof State>(
		key: Key,
		value?: State[Key],
	): State[Key] {
		if (value !== undefined) {
			this._state[key] = value;
		}
		return this._state[key];
	}

	/**
	 *
	 */
	public graph() {
		const graph: Record<string, { from: string[]; as?: string }> = {};

		for (const { provide, parents, use } of this.registry.values()) {
			graph[provide.name] = {
				from: parents.filter((it) => !!it).map((it) => it.name),
			};
			if (use?.name) {
				graph[provide.name].as = use.name;
			}
		}

		return graph;
	}

	/**
	 * True if the App is running in a browser environment.
	 */
	public isBrowser() {
		return typeof window !== "undefined";
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
	 * True when start() is called. No more services can be added.
	 */
	public isLocked(): boolean {
		return this.locked;
	}

	public isConfigured(): boolean {
		return this.configured;
	}

	/**
	 * Returns whether the App is running in a serverless environment.
	 */
	public isServerless(): boolean | "vite" | "vercel" {
		if (this.isBrowser()) {
			return false;
		}

		if (process.env.RUNTIME === "vercel") {
			return "vercel";
		}

		if (process.env.VITE_ALEPHA_DEV) {
			return "vite";
		}

		return false;
	}

	/**
	 * Returns whether the App is in test mode. (Running in a test environment)
	 */
	public isTest() {
		const env = this.env.NODE_ENV ?? process.env.NODE_ENV;
		return env === "test";
	}

	/**
	 * Returns whether the App is in production mode. (Running in a production environment)
	 */
	public isProduction() {
		const env = this.env.NODE_ENV ?? process.env.NODE_ENV;
		return env === "prod" || env === "production";
	}

	/**
	 * > configure() is automatically called by start().
	 * Use this method only if you need to configure the App without starting it.
	 *
	 * @internal
	 */
	public async configure() {
		if (this.configured) {
			return this;
		}

		this.locked = true;

		this.removeUselessDependencies();

		await this.als.configure();

		await this.emit("configure", this);

		this.configured = true;
	}

	/**
	 * Starts the App.
	 *
	 * - Lock any further changes to the container.
	 * - Run "configure" hook for all services.
	 * - Run "start" hook for all services.
	 *
	 * @return A promise that resolves when the App has started.
	 */
	public async start(): Promise<this> {
		if (this.started) {
			return this;
		}

		// make sure that start is called only once
		if (this._starting) {
			return this._starting.promise;
		}
		this._starting = Promise.withResolvers();

		const now = Date.now();

		this.log.info("Starting App...");

		await this.configure();

		await this.emit("start", this);

		this.started = true;

		await this.emit("ready", this);

		this.log.info(`App is now ready [${Date.now() - now}ms]`);

		this.ready = true;

		this._starting.resolve(this);
		this._starting = undefined;

		return this;
	}

	/**
	 * Stops the App.
	 *
	 * - Run "stop" hook for all services.
	 *
	 * @return A promise that resolves when the App has stopped.
	 */
	public async stop() {
		if (!this.started) {
			return;
		}

		this.log.info("Stopping App...");
		await this.emit("stop", this, { reverse: true });
		this.log.info("App is now off");

		this.started = false;
		this.ready = false;
	}

	/**
	 * Returns whether the specified class or type is registered in the container.
	 *
	 * @param injectable - The class or type definition to check.
	 * @param opts - Additional options for the check.
	 * @return True if the class or type is registered in the container, false otherwise.
	 */
	public has(
		injectable: ClassEntry,
		opts: { overridden?: boolean; pending?: boolean } = {},
	): boolean {
		if (injectable === Alepha) {
			return true;
		}

		const classProvider =
			"provide" in injectable ? injectable : { provide: injectable };

		if (!opts.pending) {
			const find = this.registry.get(injectable as Class);
			if (find) {
				return opts.overridden ? !!find.use : true;
			}
		}

		return this._dependencyStack.includes(classProvider.provide);
	}

	/**
	 * Registers the specified class or type in the container.
	 *
	 * - If the class or type is already registered, the method does nothing.
	 * - If the class or type is not registered, a new instance is created and registered.
	 *
	 * ClassEntry allows to provide a class swapping feature.
	 *
	 * @example
	 * ```ts
	 * class A { value = "a"; }
	 * class B { value = "b"; }
	 * class M { a = $inject(A); }
	 *
	 * Alepha.create().register({ provide: A, use: B }).get(M).a.value; // "b"
	 * ```
	 *
	 * > Swapping is an advanced feature that allows you to replace a class with another class.
	 * > It's useful for testing or for providing different implementations of a class.
	 *
	 * @param it - The class or type definitions to register in the container.
	 * @return The current instance of the container.
	 */
	public register<T extends object>(
		it: ClassEntry<T> | Promise<{ default: Class<object> }>,
	): this {
		if (this.started) {
			throw new ContainerLockedError();
		}

		if (it instanceof Promise) {
			this._lazyRegistrations.push(it);
			return this;
		}

		const isSwap = typeof it === "object";
		const isDefault = isSwap && it.default;
		const isOptional = isSwap && it.optional;

		if (isDefault) {
			if (!this.has(it.provide, { overridden: true })) {
				this.get(it);
			}
		} else {
			if (!this.has(it)) {
				this.get(it, isOptional ? { parent: null } : {});
			}
		}

		return this;
	}

	/**
	 * Alias for the 'register' method.
	 *
	 * @alias {Alepha#register}
	 */
	public with = this.register;

	/**
	 * Works like 'Alepha#register' but it must return the instance.
	 *
	 * @param entry - The class or type definition to retrieve or create.
	 * @param opts
	 * @param opts.parent - The parent class that requested the instance.
	 * @return The instance of the specified class or type.
	 */
	public get<T extends object>(
		entry: ClassEntry<T>,
		opts: {
			parent?: Class | null;
			skipCache?: boolean;
			skipRegistration?: boolean;
			args?: any[];
		} = {},
	): T {
		const parent = opts.parent !== undefined ? opts.parent : Alepha;

		// If the requested type is the container, the current instance is returned.
		if ((entry as any) === Alepha) {
			return this as any;
		}

		const classProvider = "provide" in entry ? entry : { provide: entry };

		const index = this._dependencyStack.indexOf(classProvider.provide);
		if (index !== -1) {
			throw new CircularDependencyError(
				classProvider.provide.name,
				this._dependencyStack.slice(0, index).map((it) => it.name),
			);
		}

		// The requested type is searched in the container.
		const it = this.registry.get(classProvider.provide);
		if (it && !opts.skipCache) {
			if ("use" in entry && entry.use && it.use !== entry.use) {
				if (this.started) {
					throw new ContainerLockedError();
				}

				it.use = entry.use;
				it.instance = this.get(entry.use, { parent: null });
			}

			if (!it.parents.includes(parent)) {
				it.parents.push(parent);
			}

			if (it.instance === undefined) {
				it.instance = this.new(it.use ?? it.provide, opts.args);
			}

			return it.instance;
		}

		if (this.started && !opts.skipRegistration) {
			throw new ContainerLockedError(
				`Container is locked. No more services can be added. ${parent?.name} -> ${classProvider.provide.name}`,
			);
		}

		// If the requested type is not found in the container, a new instance is created
		const instance: T =
			"use" in entry && entry.use
				? // -> Alepha#get instead of Alepha#new in order to allow swap-redirection
					this.get(entry.use, { parent: null })
				: this.new(classProvider.provide, opts.args);

		if (!opts.skipRegistration) {
			this.registry.set(classProvider.provide, {
				...classProvider,
				instance,
				parents: [parent],
			});
		}

		return instance;
	}

	public on<T extends keyof Hooks>(event: T, hook: Hook<T>) {
		if (!this._events[event]) {
			this._events[event] = [];
		}

		if (hook.priority === "first") {
			this._events[event].unshift(hook);
		} else if (hook.priority === "last") {
			this._events[event].push(hook);
		} else {
			const index = this._events[event].findIndex(
				(it) => it.priority === "last",
			);
			if (index !== -1) {
				this._events[event].splice(index, 0, hook);
			} else {
				this._events[event].push(hook);
			}
		}

		return () => {
			this._events[event] = this._events[event].filter(
				(it) => it.callback !== hook.callback,
			);
		};
	}

	public async emit<T extends keyof Hooks>(
		func: keyof Hooks,
		payload: Hooks[T],
		options: {
			reverse?: boolean;
			log?: boolean;
		} = {},
	): Promise<void> {
		if (!this.locked) {
			throw new AppNotStartedError();
		}

		const ctx: any = {};

		if (options.log) {
			ctx.now = Date.now();
			this.log.trace(`${func} ...`);
		}

		let events = this._events[func] ?? [];

		if (options.reverse) {
			events = events.toReversed();
		}

		for (const hook of events) {
			const name = hook.caller.name;
			if (options.log !== false) {
				ctx.now2 = Date.now();
				this.log.trace(`${func}(${name}) ...`);
			}

			await hook.callback(payload);

			if (options.log) {
				this.log.debug(`${func}(${name}) OK [${Date.now() - ctx.now2}ms]`);
			}
		}

		if (options.log) {
			this.log.debug(`${func} OK [${Date.now() - ctx.now}ms]`);
		}
	}

	/**
	 * Casts the given value to the specified schema.
	 *
	 * It uses the TypeBox library to validate the value against the schema.
	 *
	 * @param schema - The schema to cast the value to.
	 * @param value - The value to cast.
	 * @param opts - default: true, clean: true, convert: true, decode: true, encode: false
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
		const exists = this._cacheTypeCheck.get(schema);
		const check = exists ?? TypeCompiler.Compile(schema);
		if (!exists) {
			this._cacheTypeCheck.set(schema, check);
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
			} catch (error) {
				// ignore json parsing and let typebox handle it
			}
		}

		const copy =
			typeof value === "object" && opts.clone !== false && !alreadyParsed
				? // we clone simple objects to avoid mutation - most of the time...
					// -> Why not using structuredClone()?
					// "structuredClone()" will fail when the object contains functions to remove - which is the case for ER project.
					// so, keep using JSON.stringify/parse or make an option to use structuredClone
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
		if (this._cacheEnv.has(schema)) {
			return this._cacheEnv.get(schema) as Static<T>;
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

		this._cacheEnv.set(schema, config);

		return config;
	}

	/**
	 * Returns all registered services that match the specified descriptor.
	 *
	 * @param descriptor
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
	 * Create a new instance of a logger.
	 *
	 * @returns The newly created logger instance.
	 */
	protected createLogger(env: Env): Logger {
		return new Logger({
			als: this.als,
			level: env.LOG_LEVEL ?? (this.isTest() ? "error" : "info"),
			name: env.APP_NAME,
			json: env.LOG_FORMAT === "json",
			caller: "Alepha",
			color:
				!env.NO_COLOR &&
				env.FORCE_COLOR !== "0" &&
				env.NODE_ENV !== "production",
		});
	}

	/**
	 * Creates a new instance of a given class with dependency injection.
	 *
	 * @param definition - The class for which to create a new instance.
	 * @param args - The arguments to pass to the class constructor
	 * @returns The newly created instance of the given class.
	 */
	protected new<T extends object>(definition: Class<T>, args: any[] = []): T {
		// we keep a tree of dependencies to detect circular dependencies
		// it's also useful for cleaning are global cursor
		this._dependencyStack.push(definition);

		//
		// we use a global cursor to store the current context and definition
		// as new() is synchronous, there is no worry to do that
		//
		__alephaRef.context = this;
		__alephaRef.definition = definition;

		const instance: T = new definition(...args);

		const obj = instance as unknown as Record<string, any>;
		for (const key of Object.keys(obj)) {
			if (obj[key]?.[KIND] && obj[key].options) {
				obj[key].options.name ??= key;
			}
			const provider = obj[key]?.[PROVIDER];
			if (provider) {
				Object.defineProperty(instance, key, {
					get: () => {
						return this.get(provider, { parent: definition });
					},
				});
			}
		}

		this._dependencyStack.pop();

		// tree is empty, now we can clean the global cursor
		if (this._dependencyStack.length === 0) {
			__alephaRef.context = undefined;
		}

		__alephaRef.definition =
			this._dependencyStack[this._dependencyStack.length - 1];

		return instance;
	}

	/**
	 * Removes all useless dependencies.
	 *
	 * @protected
	 */
	protected removeUselessDependencies() {
		let repeat = true;
		while (repeat) {
			repeat = false;

			const registry: Map<Class, ClassProvider> = new Map();

			for (const item of this.registry.values()) {
				let ok = false;

				for (const parent of item.parents) {
					if (parent === Alepha) {
						ok = true;
						break;
					}

					item.parents = item.parents.filter(
						(it) => it === Alepha || (!!it && !!this.registry.get(it)),
					);

					if (item.parents.length > 0) {
						ok = true;
						break;
					}
				}

				if (ok) {
					registry.set(item.provide, item);
					continue;
				}

				const isUsedBySwap = !!this.registry
					.values()
					.find((it) => it.use === item.provide);

				if (isUsedBySwap) {
					registry.set(item.provide, item);
					continue;
				}

				repeat = true;
			}

			this.registry = registry;
		}

		// purge also events
		for (const type in this._events) {
			this._events[type] = this._events[type].filter((it) => {
				for (const { instance } of this.registry.values()) {
					if (it.caller === instance.constructor) {
						return true;
					}
				}
			});
		}
	}
}
