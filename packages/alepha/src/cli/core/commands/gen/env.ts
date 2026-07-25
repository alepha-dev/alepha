import { $inject, AlephaError, z } from "alepha";
import { $command } from "alepha/command";
import { $logger } from "alepha/logger";
import { FileSystemProvider } from "alepha/system";
import { AlephaCliUtils } from "../../services/AlephaCliUtils.ts";

export class GenEnvCommand {
  protected readonly log = $logger();
  protected readonly utils = $inject(AlephaCliUtils);
  protected readonly fs = $inject(FileSystemProvider);

  public readonly command = $command({
    name: "env",
    description: "Extract environment variables from server entry file",
    flags: z.object({
      out: z
        .text({
          aliases: ["o"],
          description: "Output file path (e.g., .env)",
        })
        .optional(),
    }),
    handler: async ({ root, flags }) => {
      const alepha = await this.utils.loadAlephaFromServerEntryFile({
        root,
        mode: "development",
      });

      try {
        const { env } = alepha.dump();

        let dotEnvFile = "";
        for (const [key, value] of Object.entries(env)) {
          if (value.description) {
            dotEnvFile += `# ${value.description.split("\n").join("\n# ")}\n`;
          }
          if (value.required && !value.default) {
            dotEnvFile += `# (required)\n`;
          }
          if (value.enum) {
            dotEnvFile += `# Possible values: ${value.enum.join(", ")}\n`;
          }
          dotEnvFile += `#${key}=${value.default || ""}\n\n`;
        }

        if (flags.out) {
          await this.fs.writeFile(this.fs.join(root, flags.out), dotEnvFile);
        } else {
          this.log.info(dotEnvFile);
        }
      } catch (err) {
        // Rethrow: the CLI only exits non-zero when the handler throws, so
        // logging and returning reported success to CI while writing nothing.
        throw new AlephaError(
          `Failed to extract environment variables - ${err instanceof Error ? err.message : String(err)}`,
          { cause: err },
        );
      }
    },
  });
}
