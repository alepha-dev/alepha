import type { Hooks } from "../Alepha.ts";
import { KIND } from "../constants/KIND.ts";
import { createPrimitive, Primitive } from "../helpers/primitive.ts";
import type { Async } from "../interfaces/Async.ts";
import type { Service } from "../interfaces/Service.ts";

/**
 * Registers a new hook.
 *
 * ```ts
 * import { $hook } from "alepha";
 *
 * class MyProvider {
 *   onStart = $hook({
 *     on: "start", // or "configure", "ready", "stop", ...
 *     handler: async (app) => {
 *       // await db.connect(); ...
 *     }
 *   });
 * }
 * ```
 *
 * Hooks are used to run async functions from all registered providers/services.
 *
 * You can't register a hook after the App has started.
 *
 * It's used under the hood by the `configure`, `start`, and `stop` methods.
 * Some modules also use hooks to run their own logic. (e.g. `alepha/server`).
 *
 * You can create your own hooks by using module augmentation:
 *
 * ```ts
 * declare module "alepha" {
 *
 *   interface Hooks {
 *     "my:custom:hook": {
 *       arg1: string;
 *     }
 *   }
 * }
 *
 * await alepha.events.emit("my:custom:hook", { arg1: "value" });
 * ```
 *
 */
export const $hook = <T extends keyof Hooks>(options: HookOptions<T>) =>
  createPrimitive(HookPrimitive<T>, options);

// ---------------------------------------------------------------------------------------------------------------------

export interface HookOptions<T extends keyof Hooks> {
  /**
   * The name of the hook. "configure", "start", "ready", "stop", ...
   */
  on: T;

  /**
   * The handler to run when the hook is triggered.
   */
  handler: (args: Hooks[T]) => Async<any>;

  /**
   * Force the hook to run first or last on the list of hooks.
   */
  priority?: "first" | "last";

  /**
   * Run this hook before the hooks owned by the specified services.
   */
  before?: object | Array<object>;

  /**
   * Run this hook after the hooks owned by the specified services.
   */
  after?: object | Array<object>;
}

// ---------------------------------------------------------------------------------------------------------------------

export class HookPrimitive<T extends keyof Hooks> extends Primitive<
  HookOptions<T>
> {
  public called = 0;

  protected onInit() {
    const handler = this.options.handler;

    const resolveDeps = (
      deps?: object | Array<object>,
    ): Service[] | undefined => {
      if (!deps) return undefined;
      const arr = Array.isArray(deps) ? deps : [deps];
      return arr.map((dep) => dep.constructor as Service);
    };

    this.alepha.events.on(this.options.on, {
      caller: this.config.service,
      priority: this.options.priority,
      before: resolveDeps(this.options.before),
      after: resolveDeps(this.options.after),
      callback: (args: any) => {
        this.called += 1;
        return handler(args);
      },
    });
  }
}

$hook[KIND] = HookPrimitive;
