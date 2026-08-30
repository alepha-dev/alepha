import { $inject, KIND } from "alepha";

import {
  type ClientScope,
  type HttpVirtualClient,
  LinkProvider,
  type RemoteVirtualClient,
} from "../providers/LinkProvider.ts";

/**
 * Create a type-safe client for a controller, in this app or in another one.
 *
 * A scope naming a `hostname` reaches a remote Alepha app, resolving against
 * that app's own `/api/_links` registry rather than anything local, so it
 * works from a CLI, a worker or a script that hosts no actions of its own.
 * Register `AlephaServerLinksClient` in such a process: it carries this
 * primitive and nothing that serves.
 *
 * The type still comes from `import type`, which is free and fully erased -
 * but the controller's source has to be reachable. Alepha does not generate
 * clients; for a consumer with no source access, serve OpenAPI through
 * `alepha/server/swagger` and let a dedicated tool read it.
 *
 * ⚠️ A remote client offers **actions only**. A local `$sse` works through the
 * handler branch and returns a real stream; a remote one would leave as a
 * plain fetch, which answers with a response, so it is dropped from the type
 * and refused by name at call time.
 *
 * ⚠️ `/api/_links` answers any caller with the anonymous action surface - that
 * is how a browser bootstraps before login. `$secure` actions are pruned from
 * it, but the names, paths and methods of unsecured ones are public.
 *
 * For the boundary against `$remote`, see that primitive's own note.
 *
 * @example
 * ```ts
 * const lore = $client<QualityController>({
 *   hostname: "https://lore.alepha.dev",
 *   authorization: () => `Bearer ${this.env.LORE_API_KEY}`,
 * });
 *
 * await lore.pushQualityRun({ params: { projectId }, body: run });
 * ```
 */
export function $client<T extends object>(
  scope: ClientScope & { hostname: string },
): RemoteVirtualClient<T>;
export function $client<T extends object>(
  scope?: ClientScope,
): HttpVirtualClient<T>;
export function $client<T extends object>(
  scope?: ClientScope,
): HttpVirtualClient<T> {
  return $inject(LinkProvider).client<T>(scope);
}

$client[KIND] = "$client";
