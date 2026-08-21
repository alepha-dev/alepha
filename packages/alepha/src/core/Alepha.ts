import { KIND } from "./constants/KIND.ts";
import { MODULE } from "./constants/MODULE.ts";
import { OPTIONS } from "./constants/OPTIONS.ts";
import { AlephaError } from "./errors/AlephaError.ts";
import { CircularDependencyError } from "./errors/CircularDependencyError.ts";
import { ContainerLockedError } from "./errors/ContainerLockedError.ts";
import { TooLateSubstitutionError } from "./errors/TooLateSubstitutionError.ts";
import { coerceObject } from "./helpers/coerceStrings.ts";
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
import type { Computed } from "./primitives/$computed.ts";
import type { InjectOptions } from "./primitives/$inject.ts";
import { Module, type WithModule } from "./primitives/$module.ts";
import { AlsProvider, type StateScope } from "./providers/AlsProvider.ts";
import { CodecManager } from "./providers/CodecManager.ts";
import { EventManager } from "./providers/EventManager.ts";
import { StateManager } from "./providers/StateManager.ts";
import {
  type Infer,
  type ZObject,
  type ZType,
  z,
} from "./providers/ZodProvider.ts";

/**
 * Where an `$env` schema was declared.
 *
 * Recorded so tooling can attribute a variable to the service and module that
 * expect it — a large application declares environment across dozens of
 * services, and a flat list gives no clue which subsystem a variable belongs
 * to.
 */
export interface EnvOwner {
  /**
   * Name of the declaring service class.
   */
  service?: string;
  /**
   * Name of the module the declaring service belongs to, if any.
   */
  module?: string;
}

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
 *     z.object({
 *  	   MY_VAR: z.text(),
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
 * 	 .then(alepha => alepha.events.emit("my:custom:hook", { arg1: "hello" }));
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

    /*
     * There used to be a second block here that read
     * `process.env?.NODE_ENV === "production"` and, when true, forced
     * `NODE_ENV: "production"` onto the state. Its intent was to carry Vite's
     * build-time value through to workerd, where the spread above finds no
     * `process.env`. It could not work, and it did real damage.
     *
     * `process.env.NODE_ENV` is the exact expression Vite's `define` rewrites. In
     * a built bundle the condition became `"production" === "production"`, the
     * minifier folded it to `true` and dropped it, and what shipped was an
     * unconditional `Object.assign(env, { NODE_ENV: "production" })`. So a built
     * server forced production at boot no matter what the environment said:
     * `NODE_ENV=development node dist` was silently ignored, and every
     * `isProduction()` gate — including the ones that refuse test-only endpoints
     * — was on in staging as much as in production.
     *
     * The block below already does the job correctly, and only when nothing has
     * been said at runtime: it reads the baked `import.meta.env.PROD` flag rather
     * than an expression the bundler substitutes, and it never overrides an
     * explicit value. Browser and Vite builds have no `process`, so the spread
     * above is dead code there and `NODE_ENV` arrives unset — which is exactly
     * the case this covers. `import.meta.env` is `undefined` outside Vite (plain
     * server bundles, workerd), making it a no-op there.
     */
    if (state.env?.NODE_ENV == null) {
      const viteEnv = (import.meta as { env?: { PROD?: boolean } }).env;
      if (viteEnv?.PROD) {
        state.env ??= {};
        Object.assign(state.env, {
          NODE_ENV: "production",
        });
      }
    }

    const alepha = new Alepha(state);

    if (alepha.isTest()) {
      // inject global hooks for testing purposes
      // > for vitest, { globals: true } is required in the config
      // Vitest/Jest publish these on the global object only when the runner
      // is configured with `globals: true`, so each one is optional. Naming
      // the shape beats `any`: a typo in one of the four would otherwise be
      // silently undefined at runtime.
      type TestHook = ((run: () => unknown) => unknown) | undefined;
      const g = globalThis as Partial<
        Record<
          "beforeAll" | "afterAll" | "afterEach" | "onTestFinished",
          TestHook
        >
      >;
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
  protected cacheEnv: Map<ZType, any> = new Map();

  /**
   * Which service/module declared each $env schema, so tooling can attribute
   * a variable to its source. Kept beside `cacheEnv` rather than inside it so
   * the parsed-value cache keeps its simple shape.
   */
  protected cacheEnvOwner: Map<ZType, EnvOwner> = new Map();

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
  /** Services already warned about a scoped -> singleton fallback. */
  protected readonly scopedFallbackWarned = new Set<Service | string>();

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

  public get<R>(target: Computed<R>, scope?: StateScope): R;
  public get<T extends TAtomObject>(
    target: Atom<T>,
    scope?: StateScope,
  ): Infer<T>;
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
   * Reset an atom back to its declared default value.
   */
  public reset<T extends TAtomObject>(target: Atom<T>): this {
    this.store.reset(target);
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
   * It means that the `configure` lifecycle hook has been emitted, which
   * happens automatically at the beginning of `start()`.
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
   * True when the named environment variable is set to an "on" value.
   *
   * Environment values are strings, and `!!"false"` is `true` — which is how
   * `MIGRATE=false` used to *activate* a `$mode`. This is the truthiness
   * check every env flag must go through: absent, `""`, `"false"` and `"0"`
   * (case-insensitive) are off; anything else is on.
   */
  public isEnvEnabled(name: string): boolean {
    const value = this.env[name];
    if (value === undefined || value === false) {
      return false;
    }
    const str = String(value).trim().toLowerCase();
    return str !== "" && str !== "false" && str !== "0";
  }

  /**
   * True if the App is running in a Continuous Integration environment.
   */
  public isCI(): boolean {
    if (this.isEnvEnabled("GITHUB_ACTIONS")) {
      return true;
    }

    return this.isEnvEnabled("CI");
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

    return this.isEnvEnabled("VITE_ALEPHA_DEV");
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

    if (this.isEnvEnabled("ALEPHA_SERVERLESS")) {
      return true;
    }

    // Vercel support
    if (this.isEnvEnabled("VERCEL_REGION")) {
      return true;
    }

    // Cloudflare Workers support
    if (
      typeof global === "object" &&
      typeof (global as { Cloudflare?: unknown }).Cloudflare === "object"
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

    let startEmitted = false;

    try {
      for (const [key] of this.substitutions.entries()) {
        this.inject(key);
      }

      const target = this.store.get("alepha.target");
      if (target) {
        this.modules = [];
        this.registry = new Map();
        this.seedCoreServices();
        this.primitiveRegistry = new Map();
        this.pendingInstantiations = [];
        this.events.clear();
        delete (target as WithModule)[MODULE];

        // The claim stays up for the whole rebuild, and `inject` rather than
        // `with` so the target itself is not swallowed by its own cutoff.
        //
        // Clearing it first — which is what this used to do — re-armed `with()`
        // for every module the target's `$inject` chain reaches. The registry
        // has just been emptied, so the first module-owned dependency looks
        // unregistered, gets its module registered again, and that module's
        // `register()` walks its whole `services` list — which contains the
        // target, still in `pendingInstantiations`. The container then reported
        // a circular dependency on the target itself. `delete target[MODULE]`
        // above only severs the target's own module link, not its dependencies'.
        this.inject(target);

        this.store.set("alepha.target", undefined);
        for (const [key] of this.substitutions.entries()) {
          this.inject(key);
        }
      }

      this.locked = true;

      await this.events.emit("configure", this, { log: true });

      this.configured = true;

      // From here on some services may hold real resources, so a failure has
      // to unwind them — see the catch below.
      startEmitted = true;

      await this.events.emit("start", this, { log: true });

      this.started = true;

      await this.events.emit("ready", this, { log: true });

      // A `ready` hook may stop the app from inside this emit — `$mode` does
      // exactly that for one-shot commands. Flipping `ready` afterwards
      // claimed a stopped container was ready, and a later `start()` would
      // short-circuit on the flag and report it as running.
      if (!this.started) {
        return this;
      }

      this.log?.info(this.readyMessage(performance.now() - now));

      this.ready = true;
      return this;
    } catch (error) {
      // Unwind whatever already started. A `start` hook throwing after
      // earlier services connected used to leave them running: resetStartup()
      // clears `started`, so a later stop() short-circuited and never emitted
      // `stop` — DB connections and listening sockets leaked with no way to
      // close them. `catch: true` so one failing teardown cannot mask the
      // original error, which is what the caller actually needs to see.
      if (startEmitted) {
        await this.events.emit("stop", this, { log: true, catch: true });
      }

      this.resetStartup();
      throw error;
    }
  }

  /**
   * Format the "ready" line, reporting the boot duration only when the runtime
   * was actually able to measure it.
   *
   * On workerd the clock does not advance during pure-CPU work — it only moves
   * after I/O — and container boot performs none: bindings (D1, KV, R2,
   * Analytics Engine) are bound, never connected. So `performance.now()` is
   * identical either side of the whole boot and the delta is exactly zero.
   *
   * Measured on a deployed Worker: 12 of 12 cold starts emitted every boot log
   * line under a single identical timestamp while burning 30-216ms of CPU, and
   * all of them printed "[0ms]". That number is not "boot was free", it is
   * "the runtime could not see boot" — and reporting it hid a real ~45ms of
   * per-cold-start CPU behind a zero. Say nothing rather than say zero.
   *
   * A sub-millisecond boot under Node still rounds to 0 but has a non-zero
   * delta, so it keeps its bracket and stays distinguishable.
   */
  protected readyMessage(elapsedMs: number): string {
    if (elapsedMs <= 0) {
      return "App is now ready";
    }

    return `App is now ready [${Math.round(elapsedMs)}ms]`;
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
    // A boot in flight has to finish before we can decide there is nothing to
    // stop: `started` is only set near the END of boot(). Returning early
    // here let the boot complete afterwards, leaving the app running after
    // the caller had already awaited stop() — reachable from `run()`'s
    // SIGTERM trap and from test teardown racing a slow start.
    //
    // Guarded on `started` because a `ready` hook may stop the app from
    // *inside* the boot ($mode does exactly this). There `started` is already
    // true and the boot promise is this call's own ancestor, so awaiting it
    // would deadlock.
    if (!this.started && this.startPromise) {
      await this.startPromise.catch(() => undefined);
    }

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
   * Put the constructor-owned singletons back into a freshly cleared
   * registry.
   *
   * `this.store` / `this.events` / `this.context` / `this.codec` are held as
   * direct fields AND registered as services. Replacing the registry without
   * re-seeding it desynchronised the two: a later `inject(StateManager)`
   * built a fresh, EMPTY instance while `alepha.store` still pointed at the
   * populated one — env gone, atom registrations gone, codec registrations
   * gone, and no error anywhere.
   */
  protected seedCoreServices(): void {
    const core: Array<[Service, object]> = [
      [StateManager as unknown as Service, this.store],
      [EventManager as unknown as Service, this.events],
      [AlsProvider as unknown as Service, this.context],
      [CodecManager as unknown as Service, this.codec],
    ];

    for (const [service, instance] of core) {
      this.registry.set(service, {
        parents: [],
        instance,
      } as ServiceDefinition<any>);
    }
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
    this.seedCoreServices();
    this.primitiveRegistry = new Map();
    this.pendingInstantiations = [];
    this.substitutions = new Map();
    this.cacheEnv = new Map();
    this.cacheEnvOwner = new Map();
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
   * Alepha.create().with({ provide: A, use: B }).inject(M).a.value; // "b"
   * ```
   *
   * > **Substitution** is an advanced feature that allows you to replace a service with another service.
   * > It's useful for testing or for providing different implementations of a service.
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
   * @alias {@link Alepha#with}.
   */
  public register<T extends object>(
    serviceEntry: ServiceEntry<T> | { default: ServiceEntry<T> },
  ): this {
    return this.with(serviceEntry);
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

    // `scoped` falls back to the global singleton registry when there is no
    // AsyncLocalStorage context — expected in browser builds, where
    // AlsProvider is a no-op, but on a server it means the caller asked for
    // per-request isolation and silently got a cross-request singleton. Warn
    // once per service so it is visible without spamming a hot path.
    let registry = this.registry;
    if (lifetime === "scoped") {
      const scoped =
        this.context.get<Map<Service, ServiceDefinition>>("registry");
      if (scoped) {
        registry = scoped;
      } else if (!this.isBrowser() && !this.scopedFallbackWarned.has(service)) {
        this.scopedFallbackWarned.add(service);
        this.log?.warn(
          `Scoped DI requested for '${typeof service === "string" ? service : service.name}' ` +
            "but no AsyncLocalStorage context is active — falling back to a singleton. " +
            "Wrap the request in `alepha.context.run()` to get per-request isolation.",
        );
      }
    }

    // If the requested type is the container, the current instance is returned.
    if ((service as unknown) === Alepha) {
      // The container is not a `T`, but asking for it is how a service reaches
      // the container it lives in — the one injection that is definitionally
      // untyped. `unknown` first because `this` and `T` do not overlap.
      return this as unknown as T;
    }

    if (typeof service === "string") {
      for (const [key, value] of registry.entries()) {
        if (key.name === service) {
          return value.instance as T;
        }
      }
      // A `provide`/`use` substitution keys the registry by the SUBSTITUTE
      // class, so a by-name lookup for the substituted base class finds no
      // registry entry — follow the substitution through the class-keyed
      // path exactly as `inject(BaseClass)` would (e.g. the generated
      // Cloudflare worker entry injecting "WebSocketServerProvider" by name
      // while the websocket module provides it via a substitution).
      for (const key of this.substitutions.keys()) {
        if (key.name === service) {
          return this.inject(key as Service<T>, { parent, lifetime });
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
      // slice(index), not slice(0, index): the cycle is the stack FROM the
      // repeated service onward. The old slice reported the callers above the
      // cycle and dropped the cycle itself (empty when the cycle starts the
      // stack).
      throw new CircularDependencyError(
        service.name,
        this.pendingInstantiations.slice(index).map((it) => it.name),
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

      // The locked-container guard protects the GLOBAL registry from gaining new
      // singletons after start. A `scoped` inject targets a per-request registry
      // (a fresh Map created by `alepha.context.run` per request, resolved at
      // `registry` above) and is stored only there — it never mutates the global
      // container. Refusing it after start makes `lifetime: "scoped"` unusable at
      // the only time it matters (while handling a request), so the guard must
      // apply only when we are instantiating into the global registry itself.
      if (this.started && registry === this.registry) {
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
   * Merge additional environment variables into the env store at runtime.
   *
   * Serverless entrypoints (Cloudflare Workers) receive their secrets and
   * vars on the runtime `env` binding rather than `process.env`, so they are
   * absent from `alepha.env` — which is frozen at `create()` from
   * `process.env`. Call this from the entrypoint to lift the binding's string
   * values into `alepha.env`, so `$env` and `alepha.env.*` resolve them (e.g.
   * `PUBLIC_URL`).
   *
   * Only string values are lifted; non-string bindings (D1, R2, KV, queues,
   * …) are skipped. Existing env values win, so explicit configuration is
   * never clobbered. The env cache is cleared so subsequent `$env` reads see
   * the merged values.
   */
  public loadEnv(env: Record<string, unknown>): this {
    const incoming: Record<string, string> = {};
    for (const [key, value] of Object.entries(env)) {
      if (typeof value === "string") {
        incoming[key] = value;
      }
    }
    this.store.set("env", { ...incoming, ...this.env });
    this.cacheEnv.clear();
    this.cacheEnvOwner.clear();
    return this;
  }

  /**
   * Applies environment variables to the provided schema and state object.
   *
   * It replaces also all templated $ENV inside string values. Write `$$KEY`
   * for a literal `$KEY` — e.g. a password containing `$PORT` declared as
   * `$$PORT` survives substitution untouched.
   *
   * @param schema - The schema object to apply environment variables to.
   * @return The schema object with environment variables applied.
   */
  public parseEnv<T extends ZObject>(schema: T, owner?: EnvOwner): Infer<T> {
    if (owner && !this.cacheEnvOwner.has(schema)) {
      // Recorded even on a cache hit path below, because the first caller to
      // parse a shared schema is not necessarily the one that declared it.
      this.cacheEnvOwner.set(schema, owner);
    }

    if (this.cacheEnv.has(schema)) {
      return this.cacheEnv.get(schema) as Infer<T>;
    }

    // Env vars are strings on the wire — coerce declared fields to their
    // schema types (boolean/number) before strict validation. Aliases are
    // resolved first, so an aliased value is coerced and validated as the key
    // it stands in for.
    const config = this.codec.validate(
      schema,
      coerceObject(schema, this.resolveEnvAliases(schema)),
    ) as Record<string, any>;

    // Sort keys longest-first to prevent substring collisions
    // (e.g. $PORT must not match inside $PORT_NAME). Patterns are compiled
    // once per key, outside the pass loop — and the key is regex-escaped:
    // keys are user input, and an unescaped `(` used to blow up the RegExp
    // constructor while `.` silently matched any character.
    const patterns = Object.keys(config)
      .sort((a, b) => b.length - a.length)
      .map((key) => {
        const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        return {
          key,
          // `$$KEY` is the escape spelling for a literal `$KEY`.
          escape: new RegExp(`\\$\\$${escaped}(?![A-Z0-9_])`, "g"),
          // Word-boundary match, so a value referencing an UNDECLARED
          // `$PORTX` is not rewritten by the declared `PORT`.
          subst: new RegExp(`\\$${escaped}(?![A-Z0-9_])`, "g"),
        };
      });

    // Neutralize `$$KEY` escapes BEFORE any substitution pass. The dollar is
    // parked as a sentinel so the multi-pass loop below can never see (and
    // substitute) the unescaped `$KEY` it protects — the old single-regex
    // approach unescaped and substituted in the same passes, so an escaped
    // `$$PORT` still came out as `$3000`. The sentinel survives transitively
    // (an escape inside a substituted value stays inert) and is restored
    // after the last pass.
    const ESCAPED_DOLLAR = "\u0000alepha:dollar\u0000";
    for (const key in config) {
      if (typeof config[key] !== "string") continue;
      for (const p of patterns) {
        // Function replacement on purpose: a replacement STRING gives `$`
        // sequences (`$&`, `$'`) special meaning.
        config[key] = (config[key] as string).replace(
          p.escape,
          () => `${ESCAPED_DOLLAR}${p.key}`,
        );
      }
    }

    let changed = true;

    // Resolve $KEY references. Multiple passes handle transitive references
    // where a replacement introduces a new $KEY that was already checked
    // (e.g. C=$B, B=$A, A=value — single pass leaves C as "$A").

    for (let pass = 0; changed && pass < 10; pass++) {
      changed = false;
      for (const key in config) {
        if (typeof config[key] !== "string") continue;
        for (const p of patterns) {
          const before = config[key] as string;
          config[key] = before.replace(p.subst, () =>
            String(config[p.key] ?? ""),
          );
          if (config[key] !== before) {
            changed = true;
          }
        }
      }
    }

    // Restore escaped dollars: `$$PORT` has now safely become `$PORT`.
    for (const key in config) {
      if (
        typeof config[key] === "string" &&
        (config[key] as string).includes(ESCAPED_DOLLAR)
      ) {
        config[key] = (config[key] as string).replaceAll(ESCAPED_DOLLAR, "$");
      }
    }

    this.cacheEnv.set(schema, config);

    return config as Infer<T>;
  }

  /**
   * Get all environment variable schemas and their parsed values.
   *
   * This is useful for DevTools to display all expected environment variables.
   */
  public getEnvSchemas(): Array<{
    schema: ZType;
    values: Record<string, any>;
    owner?: EnvOwner;
  }> {
    const result: Array<{
      schema: ZType;
      values: Record<string, any>;
      owner?: EnvOwner;
    }> = [];
    for (const [schema, values] of this.cacheEnv.entries()) {
      result.push({ schema, values, owner: this.cacheEnvOwner.get(schema) });
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
    // Force-instantiate the graph FIRST. `$env` is lazy — a key only lands in
    // `cacheEnv` once its owning service is constructed. `graph()` injects
    // every registered substitution (without emitting start/ready hooks), so
    // calling it before reading `cacheEnv` ensures `env` reflects the whole
    // app, not just whatever happened to be instantiated already. Reading
    // `cacheEnv` first (the old order) under-reported env on a not-yet-started
    // app and was internally inconsistent: dump() instantiated providers for
    // `providers` but never saw their env.
    const providers = this.graph();

    const env: Record<string, AlephaDumpEnvVariable> = {};
    for (const [schema] of this.cacheEnv.entries()) {
      // `required` field names come from `z.schema.requiredKeys` (zod has no
      // `.required` array — that name is the `.required()` method). Metadata
      // (description/enum/default) lives on the unwrapped inner schema, under
      // `.meta()`.
      const shape = z.schema.shape(schema);
      const required = new Set(z.schema.requiredKeys(schema));
      for (const [key, value] of Object.entries(shape)) {
        const inner = z.schema.unwrap(value);
        const enumValues = z.schema.isEnum(inner)
          ? z.schema.enumValues(inner)
          : undefined;
        const aliases = this.declaredAliases(value);
        env[key] = {
          // The inner (unwrapped) schema first: a `.describe()` sits on the
          // schema it was called on, which for an optional field is the inner
          // one. Falling back to the wrapper catches the reverse order.
          description: inner?.description ?? value.description,
          default: z.schema.getDefault(value) as string | undefined,
          required: required.has(key) ? true : undefined,
          aliases: aliases.length ? aliases : undefined,
          enum: enumValues?.length
            ? ([...enumValues] as Array<string>)
            : undefined,
          // Inner-then-wrapper, for the same reason as `description`: a
          // `z.text({ secret: false }).optional()` tagged the string, and the
          // ZodOptional wrapping it carries no meta of its own. `??` rather
          // than `||` so the inner schema's explicit `false` is not skipped
          // over in favour of the wrapper's absent one — and the final `?? true`
          // is what makes "nobody said" mean secret.
          secret:
            this.declaredSecret(inner) ?? this.declaredSecret(value) ?? true,
        };
      }
    }

    return {
      env,
      providers,
    };
  }

  /**
   * The `secret` marker a schema declared, or `undefined` if it declared none.
   *
   * A non-boolean `secret` in `.meta()` is dropped rather than coerced, so it
   * falls back to secret. Coercing would let `secret: "no"` — truthy, and
   * plainly meant as an opt-out — decide the question either way by accident.
   */
  protected declaredSecret(schema: unknown): boolean | undefined {
    const value = z.schema.meta(schema).secret;
    return typeof value === "boolean" ? value : undefined;
  }

  /**
   * The alternative variable names a schema declared, in the order they are
   * tried. Empty when it declared none.
   *
   * Read from the unwrapped schema first, then from the wrapper: `.meta()`
   * sits on the schema it was called on, and `z.integer().meta(…).default(0)`
   * puts it on the inner one. Non-string entries are dropped rather than
   * coerced — an alias is a variable name, and `["PORT", 3000]` is a mistake
   * worth ignoring rather than a lookup of the key `"3000"`.
   */
  protected declaredAliases(schema: unknown): Array<string> {
    const value =
      z.schema.meta(z.schema.unwrap(schema)).aliases ??
      z.schema.meta(schema).aliases;
    return Array.isArray(value)
      ? value.filter((name): name is string => typeof name === "string")
      : [];
  }

  /**
   * The environment as one declared schema sees it, with every key that is
   * absent filled in from the first of its `aliases` that is present.
   *
   * `.meta({ aliases: ["PORT"] })` is how a schema accepts a name it does not
   * own. Hosts hand values over under names of their choosing — a port they
   * allocated arrives as `PORT`, a database they provisioned as
   * `POSTGRES_URL` — and an app should read them without the framework having
   * to reserve those names. An alias is only ever read: it is not a declared
   * key, so it stays out of the `Env` type, out of {@link Alepha#dump}'s key
   * list and out of the deploy manifest, and the declared key remains the one
   * name the rest of the app refers to.
   *
   * "Absent" is asked of the raw environment, which is the only place that can
   * answer it: a schema default is applied by validation further down, and by
   * then an unset key is indistinguishable from a defaulted one.
   */
  protected resolveEnvAliases(schema: ZObject): Record<string, unknown> {
    let env: Record<string, unknown> | undefined;

    for (const [key, field] of Object.entries(z.schema.shape(schema))) {
      if (this.env[key] != null) continue;

      for (const alias of this.declaredAliases(field)) {
        const value = this.env[alias];
        if (value == null) continue;
        // Copied lazily: the overwhelmingly common case is a schema with no
        // alias to resolve, and the env map is read on every $env parse.
        env ??= { ...this.env };
        env[key] = value;
        break;
      }
    }

    return env ?? this.env;
  }

  public services<T extends object>(base: Service<T>): Array<T> {
    const list: Array<T> = [];
    for (const value of this.registry.values()) {
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

    // The finally block is what keeps a THROWING constructor from corrupting
    // the container. Without it, the service stayed forever in
    // `pendingInstantiations` — every later inject() of it reported a phantom
    // CircularDependencyError that masked the original failure — and the
    // leaked `__alephaRef` cursor made `$context()` usable outside any
    // instantiation.
    try {
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
          // `$store` hands over the Atom/Computed itself, not its key: a computed
          // has a `key` but no store entry under it. `StateManager.get` is
          // overloaded on `Computed | Atom | string`, so the object resolves both.
          const getter = value[OPTIONS].getter;
          Object.defineProperty(obj, key, {
            get: () => this.store.get(getter),
          });
        }
      }

      return instance;
    } finally {
      this.pendingInstantiations.pop();

      // tree is empty, now we can clean the global cursor
      if (this.pendingInstantiations.length === 0) {
        __alephaRef.alepha = undefined;
      }

      __alephaRef.service =
        this.pendingInstantiations[this.pendingInstantiations.length - 1];
    }
  }

  protected processPrimitive(value: Primitive, propertyKey = "") {
    value.config.propertyKey = propertyKey;
    // `onInit` is protected: a primitive must not invoke it on itself, and the
    // container is the only legitimate caller. Naming the shape would need a
    // double cast (protected vs public are not assignable), which says less
    // than this comment does.
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
  /**
   * Absent for env fields declared without a description.
   */
  description?: string;
  default?: string;
  required?: boolean;
  enum?: Array<string>;
  /**
   * Other variable names this one is read from when it is not set itself,
   * in the order they are tried. Absent when the field declared none.
   *
   * Documentation only — an alias is resolved at parse time and is never a
   * key of its own, so a consumer that lists variables should mention it
   * against the declared key rather than as a separate entry.
   */
  aliases?: Array<string>;
  /**
   * Whether the value is sensitive. **`true` unless declassified.**
   *
   * Opt OUT with `z.text({ secret: false })` (or `.meta({ secret: false })`)
   * for a var that is genuinely safe in plaintext — a public URL, a log level.
   * `secret: true` is accepted and is the default, so writing it is
   * documentation rather than a behaviour change.
   *
   * Secret-by-default for two reasons. It is what already happens: every
   * declared key is pushed to a deploy target as an encrypted binding today,
   * so an app that annotates nothing keeps exactly the behaviour it has. And
   * it is the only default that survives being forgotten — the annotation is
   * new, it WILL be missed, and a missed annotation must not be what exposes a
   * key. Always present rather than optional for the same reason: a consumer
   * writing `if (v.secret)` gets the safe answer without having to know that
   * absent meant "closed".
   */
  secret: boolean;
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

  /**
   * Public-facing base URL of the deployed app (e.g. "https://lore.alepha.dev").
   *
   * Used to render absolute links — emails, OAuth callbacks, sitemap. On the
   * Cloudflare platform it is auto-derived from the configured production
   * domain and pushed as a Worker secret by `alepha platform up`; otherwise
   * set it explicitly in `.env.<env>`. Unset → empty, and absolute-link
   * builders fall back to relative URLs.
   */
  PUBLIC_URL?: string;
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
   *     z.object({
   *       MIGRATE: z.boolean().optional(),
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

  /**
   * Triggered the first time an atom is registered in the state manager.
   */
  "state:register": {
    /**
     * The atom that was registered.
     */
    atom: Atom<any, any>;
  };
}
