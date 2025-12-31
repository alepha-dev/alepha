import { join } from "node:path";
import { $inject, AlephaError, t } from "alepha";
import { $command } from "alepha/command";
import { $logger } from "alepha/logger";
import { AlephaCliUtils } from "../services/AlephaCliUtils.ts";

export class DeployCommands {
  protected readonly log = $logger();
  protected readonly utils = $inject(AlephaCliUtils);

  /**
   * Deploy the project to a hosting platform (e.g., Vercel, Cloudflare, Surge)
   *
   * Deploy command can be overridden by creating a alepha.config.ts in the project root:
   *
   * ```ts
   * import { defineConfig } from "alepha/cli";
   *
   * export default defineConfig({
   *   commands: {
   *     deploy: {
   *       handler: async ({ root, mode, flags }) => {
   *         // Custom deployment logic here
   *       },
   *     },
   *   },
   * });
   * ```
   */
  public readonly deploy = $command({
    name: "deploy",
    description:
      "Deploy the project to a hosting platform (e.g., Vercel, Cloudflare, Surge)",
    mode: true,
    flags: t.object({
      build: t.boolean({
        description: "Build the project before deployment",
        default: false,
      }),
      migrate: t.boolean({
        description:
          "Run database migrations before deployment (if applicable)",
        default: false,
      }),
    }),
    env: t.object({
      VERCEL_TOKEN: t.optional(
        t.text({
          description: "Vercel API token (e.g., xxxxxxxxxxxxxxxxxxxx)",
        }),
      ),
      VERCEL_ORG_ID: t.optional(
        t.text({
          description: "Vercel organization ID (e.g., team_abc123...)",
        }),
      ),
      VERCEL_PROJECT_ID: t.optional(
        t.text({ description: "Vercel project ID (e.g., prj_abc123...)" }),
      ),
      CLOUDFLARE_API_TOKEN: t.optional(
        t.text({
          description: "Cloudflare API token (e.g., xxxx-xxxx-xxxx-xxxx)",
        }),
      ),
      CLOUDFLARE_ACCOUNT_ID: t.optional(
        t.text({
          description: "Cloudflare account ID (e.g., abc123def456...)",
        }),
      ),
    }),
    handler: async ({ root, mode, flags }) => {
      if (flags.build) {
        await this.utils.exec("alepha build");
      }

      // Vercel deployment
      if (await this.utils.exists(root, "dist/vercel.json")) {
        if (flags.migrate) {
          this.log.debug("Running database migrations before deployment...");
          await this.utils.exec(`alepha db migrate --mode=${mode}`);
        }
        await this.utils.ensureDependency(root, "vercel", { dev: true });
        const command =
          `vercel . --cwd=dist ${mode === "production" ? "--prod" : ""}`.trim();
        this.log.debug(`Deploying to Vercel with command: ${command}`);
        await this.utils.exec(command);
        return;
      }

      // Cloudflare deployment
      if (await this.utils.exists(root, "dist/wrangler.jsonc")) {
        if (flags.migrate) {
          this.log.debug("Running database migrations before deployment...");
          await this.utils.exec(`alepha db migrate --mode=${mode}`);
        }
        await this.utils.ensureDependency(root, "wrangler", { dev: true });
        const command =
          `wrangler deploy ${mode === "production" ? "" : "--env preview"} --config=dist/wrangler.jsonc`.trim();
        this.log.info(`Deploying to Cloudflare with command: ${command}`);
        await this.utils.exec(command);
        return;
      }

      // Surge deployment
      if (await this.utils.exists(root, "dist/public/404.html")) {
        await this.utils.ensureDependency(root, "surge", { dev: true });
        const distPath = join(root, "dist/public");
        this.log.debug(`Deploying to Surge from directory: ${distPath}`);
        await this.utils.exec(`surge ${distPath}`);
        return;
      }

      throw new AlephaError(
        "No deployment configuration found in the dist folder.",
      );
    },
  });
}
