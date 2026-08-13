import { AsyncLocalStorage } from "node:async_hooks";
import { Alepha } from "./Alepha.ts";
import type { RunOptions } from "./interfaces/Run.ts";
import type { Service } from "./interfaces/Service.ts";
import { $module } from "./primitives/$module.ts";
import { AlsProvider } from "./providers/AlsProvider.ts";
import { CodecManager } from "./providers/CodecManager.ts";
import { EventManager } from "./providers/EventManager.ts";
import { Json } from "./providers/Json.ts";
import { JsonSchemaCodec } from "./providers/JsonSchemaCodec.ts";
import { SchemaCodec } from "./providers/SchemaCodec.ts";
import { SchemaValidator } from "./providers/SchemaValidator.ts";
import { StateManager } from "./providers/StateManager.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./index.shared.ts";

// ---------------------------------------------------------------------------------------------------------------------

export const AlephaCore = $module({
  name: "alepha.core",
  // These services are instantiated directly by Alepha's constructor in a strict order.
  // Declared as `variants` (semantically: not really alternatives, but the framework
  // owns their wiring) so the module tag is attached without auto-injection.
  variants: [
    StateManager,
    CodecManager,
    EventManager,
    AlsProvider,
    Json,
    JsonSchemaCodec,
    SchemaCodec,
    SchemaValidator,
  ],
});

// ---------------------------------------------------------------------------------------------------------------------

export const run = (
  entry: Alepha | Service | Array<Service>,
  opts?: RunOptions,
): Alepha => {
  const env: Record<string, string | undefined> =
    typeof process === "object" ? process.env : {};

  const alepha =
    entry instanceof Alepha
      ? entry
      : Alepha.create({ env: { ...env, ...opts?.env } });

  if (!(entry instanceof Alepha)) {
    const entries = Array.isArray(entry) ? entry : [entry];
    for (const e of entries) {
      alepha.with(e);
    }
  }

  // make alepha globally accessible (for serverless functions, etc...)
  // it's not recommended, we should force 'export default run(alepha)'
  (globalThis as any).__alepha = alepha;

  return alepha;
};

// ---------------------------------------------------------------------------------------------------------------------

// It's allowed for now, as we use Workers with Node compat
AlsProvider.create = () => new AsyncLocalStorage();
