import { $inject, Alepha, AlephaError, t } from "alepha";
import { $command } from "alepha/command";
import { $logger } from "alepha/logger";
import { FileSystemProvider, ShellProvider } from "alepha/system";
import type { RunnerMethod } from "../../command/helpers/Runner.ts";
import { AppEntryProvider } from "../providers/AppEntryProvider.ts";
import { ViteBuildProvider } from "../providers/ViteBuildProvider.ts";
import { AlephaCliUtils } from "../services/AlephaCliUtils.ts";
import { PackageManagerUtils } from "../services/PackageManagerUtils.ts";

export class DeployCommand {
  protected readonly log = $logger();
  protected readonly alepha = $inject(Alepha);
  protected readonly fs = $inject(FileSystemProvider);
  protected readonly shell = $inject(ShellProvider);
  protected readonly utils = $inject(AlephaCliUtils);
  protected readonly pm = $inject(PackageManagerUtils);
  protected readonly boot = $inject(AppEntryProvider);
  protected readonly viteBuildProvider = $inject(ViteBuildProvider);

  public readonly deploy = $command({
    name: "deploy",
    mode: "production",
    description: "Build and deploy the project",
    flags: t.object({
      target: t.optional(
        t.enum(["bare", "docker", "vercel", "cloudflare", "static"], {
          aliases: ["t"],
          description: "Deployment target",
        }),
      ),
    }),
    handler: async ({ root, flags, run }) => {
      process.env.NODE_ENV = "production";
      await this.utils.loadEnv(root, [".env", ".env.production"]);

      // Build
      const targetFlag = flags.target ? ` -t ${flags.target}` : "";
      await this.shell.run(`alepha build${targetFlag}`, { resolve: true });

      // Deploy
      const distDir = this.fs.join(root, "dist");

      if (await this.fs.exists(this.fs.join(distDir, "wrangler.jsonc"))) {
        await this.deployToCloudflare(root, run);
      } else {
        this.log.info("No supported deployment target found in dist/");
      }
    },
  });

  // ---------------------------------------------------------------------------
  // Cloudflare
  // ---------------------------------------------------------------------------

  protected async deployToCloudflare(
    root: string,
    run: RunnerMethod,
  ): Promise<void> {
    const distDir = this.fs.join(root, "dist");

    // Login
    await run({
      name: "authenticate",
      handler: async () => {
        await this.ensureWrangler(root);
        await this.ensureLogin(run);
      },
    });

    // Analyze app to detect resources
    const entry = await this.boot.getAppEntry(root);
    const appAlepha = await this.viteBuildProvider.init({ entry });

    const name = await this.readProjectName(root);
    const slug = this.slugify(name);

    // R2
    try {
      const r2 = appAlepha.primitives("$bucket");
      if (r2.length > 0) {
        const bucketName = `alepha-${slug}-r2`;
        await run({
          name: `provision bucket (${bucketName})`,
          handler: async () => {
            await this.ensureR2(bucketName);
            await this.updateWranglerR2(distDir, bucketName);
          },
        });
      }
    } catch {}

    // D1
    let hasRepositories = false;
    try {
      const repoProvider = appAlepha.inject<any>("RepositoryProvider");
      hasRepositories = repoProvider.getRepositories().length > 0;
    } catch {}

    if (hasRepositories) {
      const dbName = `alepha-${slug}-main`;
      let dbId = "";

      await run({
        name: `provision database (${dbName})`,
        handler: async () => {
          dbId = await this.ensureD1(dbName);
          await this.updateWranglerD1(distDir, dbName, dbId);
        },
      });

      await run({
        name: "apply migrations",
        handler: async () => {
          await this.handleMigrations(root, distDir, dbName);
        },
      });
    }

    // Deploy
    const capture = !this.alepha.isCI();
    let deployedUrl: string | undefined;

    await run({
      name: "deploy worker",
      handler: async () => {
        const output = await this.shell.run(
          "wrangler deploy --no-bundle --config=dist/wrangler.jsonc",
          { resolve: true, capture },
        );

        if (capture) {
          const urlMatch = output.match(/https:\/\/[^\s]+\.workers\.dev/);
          if (urlMatch) {
            deployedUrl = urlMatch[0];
          }
        }
      },
    });

    run.end();

    if (deployedUrl) {
      process.stdout.write(`\n  \x1b[32m→\x1b[0m ${deployedUrl}\n\n`);
    }
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  protected async readProjectName(root: string): Promise<string> {
    const pkg = await this.pm.readPackageJson(root);
    if (!pkg.name) {
      throw new AlephaError(
        "Missing 'name' field in package.json. Add a project name to continue.",
      );
    }
    return pkg.name;
  }

  protected slugify(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 63);
  }

  protected async ensureWrangler(root: string): Promise<void> {
    await this.pm.ensureDependency(root, "wrangler", {
      dev: true,
      exec: (cmd, opts) => this.utils.exec(cmd, opts),
    });
  }

  protected async ensureLogin(run: RunnerMethod): Promise<void> {
    const output = await this.shell.run("wrangler whoami", {
      resolve: true,
      capture: true,
    });

    if (output.includes("not authenticated")) {
      run.pause();
      await this.shell.run("wrangler login", { resolve: true });
      run.resume();
    }
  }

  protected async ensureD1(name: string): Promise<string> {
    const output = await this.shell.run("wrangler d1 list --json", {
      resolve: true,
      capture: true,
    });

    const databases = JSON.parse(output) as any[];
    const existing = databases.find((db: any) => db.name === name);
    if (existing) {
      return existing.uuid;
    }

    const createOutput = await this.shell.run(`wrangler d1 create ${name}`, {
      resolve: true,
      capture: true,
    });

    const match = createOutput.match(/"database_id":\s*"([^"]+)"/);
    if (!match) {
      throw new AlephaError(
        `Failed to parse D1 database ID from wrangler output:\n${createOutput}`,
      );
    }

    return match[1];
  }

  protected async ensureR2(name: string): Promise<void> {
    try {
      await this.shell.run(`wrangler r2 bucket create ${name}`, {
        resolve: true,
        capture: true,
      });
    } catch (error: any) {
      const msg = String(error.stderr || error.message || "");
      if (!msg.includes("already exists")) {
        throw error;
      }
    }
  }

  protected async updateWranglerR2(
    distDir: string,
    bucketName: string,
  ): Promise<void> {
    const configPath = this.fs.join(distDir, "wrangler.jsonc");
    const config = await this.fs.readJsonFile<Record<string, any>>(configPath);

    config.r2_buckets = config.r2_buckets || [];
    config.r2_buckets.push({
      binding: bucketName,
      bucket_name: bucketName,
    });

    config.vars = config.vars || {};
    config.vars.R2_BUCKET_NAME = bucketName;

    await this.fs.writeFile(configPath, JSON.stringify(config, null, 2));
  }

  protected async updateWranglerD1(
    distDir: string,
    dbName: string,
    dbId: string,
  ): Promise<void> {
    const configPath = this.fs.join(distDir, "wrangler.jsonc");
    const config = await this.fs.readJsonFile<Record<string, any>>(configPath);

    config.d1_databases = config.d1_databases || [];
    config.d1_databases.push({
      binding: dbName,
      database_name: dbName,
      database_id: dbId,
    });

    config.vars = config.vars || {};
    config.vars.DATABASE_URL = `d1://${dbName}:${dbId}`;

    await this.fs.writeFile(configPath, JSON.stringify(config, null, 2));
  }

  protected async handleMigrations(
    root: string,
    distDir: string,
    dbName: string,
  ): Promise<void> {
    const migrationsDir = this.fs.join(root, "migrations", "sqlite");

    const env = {
      DATABASE_URL: `d1://${dbName}`,
    };

    if (await this.fs.exists(migrationsDir)) {
      await this.shell.run("alepha db check-migrations", {
        resolve: true,
        capture: !this.alepha.isCI(),
        env,
      });
    } else {
      await this.shell.run("alepha db generate --mode toto", {
        resolve: true,
        capture: !this.alepha.isCI(),
        env,
      });
    }

    // Copy migrations into dist/ for wrangler
    await this.fs.cp(migrationsDir, this.fs.join(distDir, "migrations"));

    await this.shell.run(
      `wrangler d1 migrations apply ${dbName} --remote --config=dist/wrangler.jsonc`,
      { resolve: true, capture: !this.alepha.isCI(), env: { CI: "1" } },
    );

    // Clean up
    await this.fs.rm(this.fs.join(distDir, "migrations"), {
      recursive: true,
    });
  }
}
