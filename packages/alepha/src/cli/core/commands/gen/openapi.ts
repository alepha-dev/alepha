import { $inject, AlephaError, z } from "alepha";
import { $command } from "alepha/command";
import { $logger } from "alepha/logger";
import type { ServerSwaggerProvider } from "alepha/server/swagger";
import { FileSystemProvider } from "alepha/system";
import { AlephaCliUtils } from "../../services/AlephaCliUtils.ts";

export class OpenApiCommand {
  protected readonly log = $logger();
  protected readonly utils = $inject(AlephaCliUtils);
  protected readonly fs = $inject(FileSystemProvider);

  public readonly command = $command({
    name: "openapi",
    description: "Generate OpenAPI specification from actions",
    flags: z.object({
      out: z
        .text({
          aliases: ["o"],
          description: "Output file path",
        })
        .optional(),
    }),
    handler: async ({ root, flags }) => {
      const alepha = await this.utils.loadAlephaFromServerEntryFile({
        root,
        mode: "development",
      });

      try {
        // By NAME, not by class: `alepha` is the user's container built from
        // Vite's SSR module graph, while a class imported here comes from the
        // CLI's own graph — two distinct objects for the same source. On a
        // miss `inject(class)` happily instantiates a fresh CLI-graph
        // provider, so the app got a duplicate and the "Service not found"
        // branch below was unreachable.
        const openapiProvider = alepha.inject(
          "ServerSwaggerProvider",
        ) as ServerSwaggerProvider;

        await alepha.events.emit("configure", alepha);

        let json: any = openapiProvider.json;

        if (!json) {
          json = openapiProvider.generateSwaggerDoc({
            info: {
              title: "API Documentation",
              version: "1.0.0",
            },
          });
        }

        if (!json) {
          throw new AlephaError(
            "No actions found to generate OpenAPI specification.",
          );
        }

        if (flags.out) {
          await this.fs.writeFile(
            this.fs.join(root, flags.out),
            JSON.stringify(json, null, 2),
          );
        } else {
          this.log.info(JSON.stringify(json, null, 2));
        }
      } catch (err) {
        // Rethrow: the CLI only exits non-zero when the handler throws, so
        // logging and returning reported success to CI while writing nothing.
        const message = err instanceof Error ? err.message : String(err);
        if (message.includes("Service not found")) {
          throw new AlephaError(
            "Missing $swagger() primitive in your server configuration.",
            { cause: err },
          );
        }

        throw new AlephaError(`OpenAPI generation failed - ${message}`, {
          cause: err,
        });
      }
    },
  });
}
