import { $module } from "alepha";

import { apiLinksAtom } from "./atoms/apiLinksAtom.ts";
import { linkOptionsAtom } from "./atoms/linkOptionsAtom.ts";
import { $client } from "./primitives/$client.ts";
import { $remote } from "./primitives/$remote.ts";
import { LinkProvider } from "./providers/LinkProvider.ts";
import { BatchCollector } from "./services/BatchCollector.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./atoms/apiLinksAtom.ts";
export * from "./atoms/linkOptionsAtom.ts";
export * from "./primitives/$client.ts";
export * from "./primitives/$remote.ts";
export * from "./providers/LinkProvider.ts";
export * from "./schemas/apiLinksResponseSchema.ts";
export * from "./services/BatchCollector.ts";

// ---------------------------------------------------------------- -----------------------------------------------------

export const AlephaServerLinksClient = $module({
  name: "alepha.server.links.client",
  atoms: [apiLinksAtom, linkOptionsAtom],
  primitives: [$client],
  services: [LinkProvider, BatchCollector],
});

/**
 * In the browser there is nothing to serve, so the canonical name resolves to
 * the consumer half. Kept as its own module rather than an alias so the name
 * in logs stays `alepha.server.links`, as it has always been, and so both
 * export names exist in both barrels.
 */
export const AlephaServerLinks = $module({
  name: "alepha.server.links",
  imports: [AlephaServerLinksClient],
  primitives: [$remote],
});
