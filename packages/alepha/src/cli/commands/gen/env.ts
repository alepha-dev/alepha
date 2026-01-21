import { $inject, t } from "alepha";
import { $command } from "alepha/command";
import { FileSystemProvider } from "alepha/file";
import { $logger } from "alepha/logger";
import { AlephaCliUtils } from "../../services/AlephaCliUtils.ts";

export class GenEnvCommand {
  protected readonly log = $logger();
  protected readonly utils = $inject(AlephaCliUtils);
  protected readonly fs = $inject(FileSystemProvider);

  public readonly command = $command({
    name: "env",
    description: "Extract environment variables from server entry file",
    flags: t.object({
      out: t.optional(
        t.text({
          aliases: ["o"],
          description: "Output file path (e.g., .env)",
        }),
      ),
    }),
    handler: async ({ root, flags }) => {
      const { alepha } = await this.utils.loadAlephaFromServerEntryFile(root);

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
        this.log.error("Failed to extract environment variables", err);
      }
    },
  });
}
