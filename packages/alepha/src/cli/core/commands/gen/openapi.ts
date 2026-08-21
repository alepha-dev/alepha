import { $inject, type Alepha, AlephaError, z } from "alepha";
import { $command, ConsoleOutputProvider } from "alepha/command";
import type { ServerSwaggerProvider } from "alepha/server/swagger";
import { FileSystemProvider } from "alepha/system";

import { AlephaCliUtils } from "../../services/AlephaCliUtils.ts";

export class OpenApiCommand {
  protected readonly utils = $inject(AlephaCliUtils);
  protected readonly fs = $inject(FileSystemProvider);
  protected readonly output = $inject(ConsoleOutputProvider);

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
        // provider, so the app got a duplicate.
        //
        // When it is genuinely absent, register it rather than refusing to
        // work. Generating a spec is a build-time concern derived purely from
        // the `$action` primitives already in the container; making it
        // conditional on the app also mounting a runtime `/docs` UI is a
        // requirement with no technical basis. `$swagger()` stays meaningful —
        // when present, its configured document is what gets emitted below.
        const openapiProvider = (await this.injectSwaggerProvider(
          alepha,
        )) as ServerSwaggerProvider;

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

        const document = JSON.stringify(json, null, 2);

        if (flags.out) {
          // `resolve`, not `join`: an absolute `--out` used to be reparented
          // under the project root, so `-o /tmp/api.json` failed on
          // `<root>/tmp/api.json`.
          await this.fs.writeFile(this.fs.resolve(root, flags.out), document);
        } else {
          // The document is what this command *produces*, so it goes through
          // the output provider — never the logger, which prefixes a timestamp
          // and a level and emits ANSI whether or not stdout is a TTY. That is
          // why `alepha gen openapi > api.json` used to write a file whose
          // first line was `<esc>[90m14:31:18 I {`.
          this.output.print(document);
        }
      } catch (err) {
        // Rethrow: the CLI only exits non-zero when the handler throws, so
        // logging and returning reported success to CI while writing nothing.
        const message = err instanceof Error ? err.message : String(err);

        throw new AlephaError(`OpenAPI generation failed - ${message}`, {
          cause: err,
        });
      }
    },
  });

  /**
   * Resolve the app's swagger provider, registering the module first if the
   * app doesn't mount one.
   *
   * The module has to be imported through the app's own Vite SSR graph. A
   * static import at the top of this file is a *different object* for the same
   * source — the CLI's copy — and registering that would give the container a
   * parallel set of services whose `$action` primitives are not the app's, so
   * the generated spec would come back empty.
   */
  protected async injectSwaggerProvider(alepha: Alepha): Promise<unknown> {
    try {
      return alepha.inject("ServerSwaggerProvider");
    } catch (err) {
      if (!(err instanceof Error) || !err.message.includes("Service not found"))
        throw err;

      const { AlephaServerSwagger } = await this.utils.importFromAppGraph(
        "alepha/server/swagger",
      );

      alepha.with(AlephaServerSwagger);

      return alepha.inject("ServerSwaggerProvider");
    }
  }
}
