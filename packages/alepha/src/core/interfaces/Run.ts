import type { Alepha, Env } from "../Alepha.ts";
import type { Async } from "./Async.ts";

export interface RunOptions {
  /**
   * Environment variables to be used by the application.
   * It will be merged with the current process environment.
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
