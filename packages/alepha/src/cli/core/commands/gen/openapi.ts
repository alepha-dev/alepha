import { $inject, z } from "alepha";
import { $command } from "alepha/command";
import { $logger } from "alepha/logger";
import { ServerSwaggerProvider } from "alepha/server/swagger";
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
        const openapiProvider = alepha.inject(
          ServerSwaggerProvider,
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
          this.log.error("No actions found to generate OpenAPI specification.");
          return;
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
        const message = err instanceof Error ? err.message : String(err);
        if (message.includes("Service not found")) {
          this.log.error(
            "Missing $swagger() primitive in your server configuration.",
          );
          return;
        }

        this.log.error(`OpenAPI generation failed - ${message}`, err);
      }
    },
  });
}
