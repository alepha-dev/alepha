import { $module } from "./primitives/$module.ts";
import { AlsProvider } from "./providers/AlsProvider.ts";
import { CodecManager } from "./providers/CodecManager.ts";
import { EventManager } from "./providers/EventManager.ts";
import { Json } from "./providers/Json.ts";
import { JsonSchemaCodec } from "./providers/JsonSchemaCodec.ts";
import { SchemaCodec } from "./providers/SchemaCodec.ts";
import { SchemaValidator } from "./providers/SchemaValidator.ts";
import { StateManager } from "./providers/StateManager.ts";

/**
 * Foundation of the entire framework with dependency injection and lifecycle management.
 *
 * **Features:**
 * - Dependency injection for services
 * - Service substitution/mocking
 * - Type-safe environment variable loading with Zod schemas
 * - Lifecycle hooks (start, stop, log, etc.)
 * - Module definitions and composition
 * - Request-scoped context access via Async Local Storage (ALS)
 * - Reactive state management with atoms
 * - Full TypeScript generics and type inference
 *
 * @module alepha.core
 */
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
