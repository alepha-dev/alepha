/**
 * What `alepha/cli` is under the `workerd` export condition: the build tasks a
 * Worker can run, and nothing that would stop a Worker bundling.
 *
 * ⚠️ **Deliberately a fraction of the Node entry, not a mirror of it.** The
 * usual rule for a split-condition barrel is that both sides export the same
 * names, because `tsc` resolves one condition and drift is invisible until
 * runtime (folio #82). Here the asymmetry IS the feature: `alepha/cli`'s Node
 * entry reaches Vite, `node:child_process` and every command, and a Worker can
 * bundle none of it. So a Worker importing a name this file omits fails at
 * BUILD time in CI, which is exactly where that mistake should land, and
 * `workerd-entry-graph.spec.ts` proves the closure stays clean rather than
 * asserting two signatures match.
 *
 * What a Worker wants from the CLI is epic #1's deploy: unpack an artifact,
 * regenerate `wrangler.jsonc` against freshly provisioned resource ids, upload.
 * That is {@link BuildCloudflareTask} and the manifest schema. It is emphatically
 * not the build: Lore's Worker cannot run Vite, so the client always builds.
 *
 * @module alepha.cli
 */
import { $module } from "alepha";

import { buildOptions } from "./atoms/buildOptions.ts";
import { BuildCloudflareTask } from "./tasks/BuildCloudflareTask.ts";

export * from "./atoms/buildOptions.ts";
export * from "./schemas/buildManifest.ts";
export * from "./schemas/presetSchema.ts";
export * from "./tasks/BuildCloudflareTask.ts";
export * from "./tasks/BuildTask.ts";

/**
 * `BuildTaskContext` names it, so a consumer typing a context needs it. A
 * `export type` and never `export *`: the provider it lives on reads the
 * filesystem and spawns a package manager, and only the type is erased.
 */
export type { AppEntry } from "./providers/AppEntryProvider.ts";

/**
 * Same name as the Node module, and one task inside it.
 *
 * The name matters more than the contents: `Alepha.inject` registers the module
 * that DECLARES a service, so `BuildCloudflareTask[MODULE]` points here under
 * workerd and at the full module under Node. A Worker that injects the task
 * gets a container with one task in it; the same code under Node gets the ten.
 * `AlephaSystem` swaps its providers by condition the same way.
 */
export const AlephaCliServices = $module({
  name: "alepha.cli.services",
  atoms: [buildOptions],
  services: [BuildCloudflareTask],
});
