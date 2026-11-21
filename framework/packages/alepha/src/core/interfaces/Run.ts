import type { Alepha, Env } from "../Alepha.ts";
import type { Async } from "./Async.ts";

export interface RunOptions {
  /**
   * Environment variables to be used by the application.
   *
   * When `run` creates the container (a service or a list of services), they
   * are merged over the current process environment.
   *
   * When `run` receives an existing container, they are merged over that
   * container's env and apply to the `$env` reads made after `run`: a service
   * already built keeps the values it was given, and the process environment
   * is not merged.
   */
  env?: Env;

  /**
   * A callback that will be executed before the application starts.
   */
  configure?: (alepha: Alepha) => Async<void>;

  /**
   * A callback that will be executed once the application is ready.
   * This is useful for initializing resources or starting background tasks.
   */
  ready?: (alepha: Alepha) => Async<void>;

  /**
   * If true, the application will .stop() after the ready callback is executed.
   * Useful for one-time tasks!
   */
  once?: boolean;
}
