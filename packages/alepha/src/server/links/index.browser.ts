import { $module } from "alepha";
import { apiLinksAtom } from "./atoms/apiLinksAtom.ts";
import { linkOptionsAtom } from "./atoms/linkOptionsAtom.ts";
import { $client } from "./primitives/$client.ts";
import { $remote } from "./primitives/$remote.ts";
import { LinkProvider } from "./providers/LinkProvider.ts";
import { BatchCollector } from "./services/BatchCollector.ts";
import { DefinitionsPool } from "./services/DefinitionsPool.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./atoms/apiLinksAtom.ts";
export * from "./atoms/linkOptionsAtom.ts";
export * from "./primitives/$client.ts";
export * from "./primitives/$remote.ts";
export * from "./providers/LinkProvider.ts";
export * from "./schemas/apiLinksResponseSchema.ts";
export * from "./services/BatchCollector.ts";
export * from "./services/DefinitionsPool.ts";

// ---------------------------------------------------------------- -----------------------------------------------------

export const AlephaServerLinks = $module({
  name: "alepha.server.links",
  atoms: [apiLinksAtom, linkOptionsAtom],
  primitives: [$remote, $client],
  services: [LinkProvider, BatchCollector, DefinitionsPool],
});
