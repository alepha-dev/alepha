import { $inject, AlephaError, z } from "alepha";
import { $command, ConsoleOutputProvider } from "alepha/command";
import { FileSystemProvider } from "alepha/system";
import { AlephaCliUtils } from "../../services/AlephaCliUtils.ts";

export class GenEnvCommand {
  protected readonly utils = $inject(AlephaCliUtils);
  protected readonly fs = $inject(FileSystemProvider);
  protected readonly output = $inject(ConsoleOutputProvider);

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
          // Named against the key it feeds rather than as an entry of its own:
          // an alias is read, never written, so a reader who pastes a value
          // must paste it here.
          if (value.aliases) {
            dotEnvFile += `# Also read from: ${value.aliases.join(", ")}\n`;
          }
          // Every var is a secret unless it opted out, so the exception is what
          // carries the label — marking the secrets instead would repeat the
          // same line on nearly every key and tell the reader nothing. Last
          // annotation before the key, so it reads as a label ON the line a
          // human is about to paste a value into.
          if (value.secret === false) {
            dotEnvFile += `# (public)\n`;
          }
          dotEnvFile += `#${key}=${value.default || ""}\n\n`;
        }

        if (flags.out) {
          // `resolve`, not `join`: an absolute `--out` used to be reparented
          // under the project root, so `-o /tmp/.env` failed on
          // `<root>/tmp/.env`.
          await this.fs.writeFile(this.fs.resolve(root, flags.out), dotEnvFile);
        } else {
          // The template is what this command *produces*, so it goes through
          // the output provider — never the logger, which prefixes a timestamp
          // and a level and emits ANSI whether or not stdout is a TTY. That is
          // why `alepha gen env > .env.example` used to write a first line
          // reading `<esc>[90m14:31:16 I #DATABASE_URL=`.
          this.output.print(dotEnvFile);
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
