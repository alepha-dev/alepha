import { access, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { $inject, AlephaError, t } from "alepha";
import { $command, CliProvider } from "alepha/command";
import { $logger } from "alepha/logger";
import * as tar from "tar";

export class CreateAlephaCoreCommands {
  protected readonly log = $logger();
  protected readonly cli = $inject(CliProvider);

  protected detectPackageManager(): "npm" | "yarn" | "pnpm" | "bun" {
    const ua = process.env.npm_config_user_agent || "";
    if (ua.startsWith("yarn")) return "yarn";
    if (ua.startsWith("pnpm")) return "pnpm";
    if (ua.startsWith("bun")) return "bun";
    return "npm";
  }

  /**
   * Download Alepha starter project from GitHub.
   */
  public async downloadSampleProject(targetDir: string): Promise<void> {
    const url = "https://api.github.com/repos/feunard/alepha/tarball/main";
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Alepha-CLI",
      },
    });

    if (!response.ok) {
      throw new AlephaError(`Failed to download: ${response.statusText}`);
    }

    const tarStream = Readable.fromWeb(response.body as any);
    await pipeline(
      tarStream,
      tar.extract({
        cwd: targetDir,
        strip: 3, // Remove feunard-alepha-<hash>/apps/starter prefix
        filter: (path) => {
          const parts = path.split("/");
          return (
            parts.length >= 3 && parts[1] === "apps" && parts[2] === "starter"
          );
        },
      }),
    );
  }

  /**
   * Called when no command is provided - shows help or creates a new project
   */
  public readonly root = $command({
    root: true,
    description: "Create a new Alepha project",
    args: t.optional(
      t.text({
        title: "name",
      }),
    ),
    summary: false,
    handler: async ({ run, args, flags, root }) => {
      const name = args ?? "my-app";
      const dest = join(root, name);

      try {
        await access(dest);
        this.log.error(
          `Directory "${name}" already exists. Please choose a different project name.`,
        );
        return;
      } catch {
        // Directory does not exist, proceed
      }

      const pm = this.detectPackageManager();

      await mkdir(dest, { recursive: true }).catch(() => null);

      await run("Downloading sample project", () =>
        this.downloadSampleProject(dest),
      );

      await run(`cd ${name} && ${pm} install`, {
        alias: "Installing dependencies",
      });

      await run(`cd ${name} && ${pm} run lint`, {
        alias: "Linting code",
      });

      await run(`cd ${name} && ${pm} run typecheck`, {
        alias: "Type checking",
      });

      await run(`cd ${name} && ${pm} run test`, {
        alias: "Running tests",
      });

      await run(`cd ${name} && ${pm} run build`, {
        alias: "Building project",
      });

      this.log.info("");
      this.log.info(`$ cd ${name} && ${pm} run dev`.trim());
      this.log.info("");
    },
  });
}
