import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { $env, AlephaError, type Static, t } from "alepha";
import { $logger } from "alepha/logger";
import { S3mini } from "s3mini";

// All fields are declared optional so the schema parses cleanly during
// `alepha build` (which boots the app to discover endpoints without
// real credentials in scope). Required-at-runtime is enforced by
// `assertConfigured()` when an actual fetch is attempted.
const envSchema = t.object({
  S3_ENDPOINT: t.optional(t.string()),
  S3_REGION: t.optional(t.string()),
  S3_ACCESS_KEY_ID: t.optional(t.string()),
  S3_SECRET_ACCESS_KEY: t.optional(t.string()),
});
declare module "alepha" {
  interface Env extends Partial<Static<typeof envSchema>> {}
}

/**
 * Downloads pre-built artifacts from an S3-compatible bucket and
 * extracts them into a workspace directory that `alepha platform` can
 * run against.
 *
 * Expected artifact layout (tar.gz):
 *
 *   ./dist/             output of `alepha build --target=cloudflare`
 *   ./migrations/       e.g. migrations/sqlite/*.sql
 *   alepha.config.ts    workspace config
 *
 * Extraction uses the system `tar` binary — always available on the
 * Linux base image, no extra npm dep, streams cleanly without loading
 * the whole archive into memory.
 */
export class ArtifactService {
  protected readonly log = $logger();
  protected readonly env = $env(envSchema);
  protected readonly clients = new Map<string, S3mini>();

  /**
   * Where to extract artifacts. Defaults to `<cwd>/workspace` so the
   * extracted dirs sit alongside Rocket's own `dist/` and Node walks
   * up into `dist/node_modules/` for `alepha` / `wrangler` resolution.
   * Override with `ROCKET_WORKSPACE_ROOT` (tests, alternative layouts).
   */
  protected resolveWorkspaceRoot(): string {
    if (process.env.ROCKET_WORKSPACE_ROOT) {
      return resolve(process.env.ROCKET_WORKSPACE_ROOT);
    }
    return resolve(process.cwd(), "workspace");
  }

  protected getClient(bucket: string): S3mini {
    this.assertConfigured();
    const name = bucket.replaceAll("/", "-").replaceAll("_", "-").toLowerCase();
    const cached = this.clients.get(name);
    if (cached) return cached;
    const endpoint = this.env.S3_ENDPOINT!.replace(/\/+$/, "");
    const client = new S3mini({
      accessKeyId: this.env.S3_ACCESS_KEY_ID!,
      secretAccessKey: this.env.S3_SECRET_ACCESS_KEY!,
      region: this.env.S3_REGION || "auto",
      endpoint: `${endpoint}/${name}`,
    });
    this.clients.set(name, client);
    return client;
  }

  protected assertConfigured(): void {
    const missing = [
      "S3_ENDPOINT",
      "S3_ACCESS_KEY_ID",
      "S3_SECRET_ACCESS_KEY",
    ].filter((key) => !this.env[key as keyof typeof this.env]);
    if (missing.length > 0) {
      throw new AlephaError(
        `Rocket is missing required env vars: ${missing.join(", ")}. ` +
          "Set them on the container before starting Rocket.",
      );
    }
  }

  /**
   * Fetch the artifact at `bucket/key`, extract it into the workspace
   * directory under the running container's dist (so node module
   * resolution walks up into `dist/node_modules/` where `alepha` +
   * `wrangler` are installed), and return the workspace path. Caller
   * is responsible for calling `cleanup()` once the deploy is done.
   *
   * Layout produced:
   *
   *   <workspaceRoot>/<deployId>.tar.gz   (downloaded archive)
   *   <workspaceRoot>/<deployId>/         (extracted workspace, returned)
   *
   * `workspaceRoot` defaults to `<container-dist>/workspace`. Override
   * via `ROCKET_WORKSPACE_ROOT` env var (handy for tests).
   */
  public async fetch(options: {
    deployId: string;
    bucket: string;
    key: string;
  }): Promise<{ workspace: string; cleanup: () => Promise<void> }> {
    const { deployId, bucket, key } = options;
    const workspaceRoot = this.resolveWorkspaceRoot();
    await mkdir(workspaceRoot, { recursive: true });
    const workdir = join(workspaceRoot, deployId);
    const archive = `${workdir}.tar.gz`;

    // Wipe any leftover from a prior deploy that crashed before its
    // cleanup ran (container restart mid-run, hard fault, etc.). tar
    // refuses to overwrite Brotli-precompressed `.br` siblings with
    // "File exists", so a fresh dir is mandatory.
    await rm(workdir, { recursive: true, force: true });
    await rm(archive, { force: true });
    await mkdir(workdir, { recursive: true });

    this.log.info(`Fetching s3://${bucket}/${key} → ${archive}`);
    const response = await this.getClient(bucket).getObjectResponse(key);
    if (!response || !response.ok || !response.body) {
      throw new AlephaError(
        `Artifact not found: s3://${bucket}/${key} (status ${response?.status ?? "no-response"})`,
      );
    }

    await pipeline(
      Readable.fromWeb(response.body as never),
      createWriteStream(archive),
    );

    this.log.info(`Extracting ${archive} → ${workdir}`);
    await this.extract(archive, workdir);

    const cleanup = async () => {
      await rm(workdir, { recursive: true, force: true });
      await rm(archive, { force: true });
    };

    return { workspace: workdir, cleanup };
  }

  protected async extract(archive: string, dest: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const proc = spawn("tar", ["-xzf", archive, "-C", dest], {
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stderr = "";
      proc.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });
      proc.on("error", reject);
      proc.on("exit", (code) => {
        if (code === 0) resolve();
        else
          reject(
            new AlephaError(
              `tar exited with code ${code}: ${stderr.trim() || "no output"}`,
            ),
          );
      });
    });
  }
}
