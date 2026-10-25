import { Alepha } from "./Alepha.ts";
import type { RunOptions } from "./interfaces/Run.ts";
import type { Service } from "./interfaces/Service.ts";

export * from "./index.shared.ts";

if (!Promise.withResolvers) {
  Promise.withResolvers = <T>() => {
    let resolve: (value: T | PromiseLike<T>) => void;
    let reject: (reason?: any) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve: resolve!, reject: reject! };
  };
}

/**
 * Register a native application with optional environment overrides.
 * The native host owns startup. Only `env` is supported here.
 */
export const run = (
  entry: Alepha | Service | Array<Service>,
  opts?: Pick<RunOptions, "env">,
): Alepha => {
  const alepha =
    entry instanceof Alepha ? entry : Alepha.create({ env: { ...opts?.env } });

  if (entry instanceof Alepha && opts?.env) {
    alepha.store.set("env", { ...alepha.env, ...opts.env });
    // Explicit run options take precedence; refresh previously parsed env schemas.
    alepha.loadEnv({});
  }

  if (!(entry instanceof Alepha)) {
    const entries = Array.isArray(entry) ? entry : [entry];
    for (const e of entries) {
      alepha.with(e);
    }
  }

  return alepha;
};
