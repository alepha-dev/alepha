import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { $hook, $inject, Alepha, t } from "alepha";
import { $logger } from "alepha/logger";
import { $route, ServerProvider } from "alepha/server";
import { $serve } from "alepha/server/static";
import { devMetadataSchema } from "../schemas/DevMetadata.ts";
import { DevToolsMetadataProvider } from "./DevToolsMetadataProvider.ts";

export class DevToolsProvider {
  protected readonly log = $logger();
  protected readonly alepha = $inject(Alepha);
  protected readonly serverProvider = $inject(ServerProvider);
  protected readonly devCollectorProvider = $inject(DevToolsMetadataProvider);

  protected readonly onStart = $hook({
    on: "start",
    handler: () => {
      this.log.info("Devtools OK", {
        url: `${this.serverProvider.hostname}/__devtools/`,
      });
    },
  });

  protected readonly uiRoute = $serve({
    path: "/__devtools",
    root: join(
      fileURLToPath(import.meta.url),
      "../../../../assets/devtools-ui",
    ),
    historyApiFallback: true,
    silent: true,
  });

  protected readonly metadataRoute = $route({
    method: "GET",
    path: "/__devtools/api/metadata",
    silent: true,
    schema: {
      response: devMetadataSchema,
    },
    handler: () => {
      return this.devCollectorProvider.getMetadata();
    },
  });

  protected readonly updateAtomRoute = $route({
    method: "POST",
    path: "/__devtools/api/atoms",
    silent: true,
    schema: {
      body: t.object({
        name: t.text(),
        value: t.any(),
      }),
      response: t.object({
        success: t.boolean(),
      }),
    },
    handler: ({ body }) => {
      const atoms = this.alepha.store.getAtoms(false);
      const atomEntry = atoms.find((a) => a.atom.key === body.name);

      if (atomEntry) {
        this.alepha.store.set(atomEntry.atom, body.value);
        return { success: true };
      }

      return { success: false };
    },
  });
}
