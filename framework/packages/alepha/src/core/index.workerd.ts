import { AsyncLocalStorage } from "node:async_hooks";

import { Alepha } from "./Alepha.ts";
import type { RunOptions } from "./interfaces/Run.ts";
import type { Service } from "./interfaces/Service.ts";
import { AlsProvider } from "./providers/AlsProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./index.shared.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Register a workerd application with optional environment overrides.
 * The generated Worker entry starts the application on demand.
 *
 * `globalThis.__alepha` is an internal handshake with that generated entry,
 * which cannot require the user to export the container. Application code
 * must keep and use its own instance instead. Only `env` is supported here.
 */
export const run = (
  entry: Alepha | Service | Array<Service>,
  opts?: Pick<RunOptions, "env">,
): Alepha => {
  const env: Record<string, string | undefined> =
    typeof process === "object" ? process.env : {};

  const alepha =
    entry instanceof Alepha
      ? entry
      : Alepha.create({ env: { ...env, ...opts?.env } });

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

  // Internal handshake consumed by the generated Worker entry.
  (globalThis as any).__alepha = alepha;

  return alepha;
};

// ---------------------------------------------------------------------------------------------------------------------

// It's allowed for now, as we use Workers with Node compat
AlsProvider.create = () => new AsyncLocalStorage();
