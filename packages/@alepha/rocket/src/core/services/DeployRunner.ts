import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { $inject } from "alepha";
import { $logger } from "alepha/logger";
import { DeployRegistry } from "../providers/DeployRegistry.ts";
import type { CreateDeploy } from "../schemas/deploy.ts";
import { ArtifactService } from "./ArtifactService.ts";

/**
 * Runs a single deploy run end-to-end.
 *
 * For each `createDeploy` request:
 *
 *   1. Download `{bucket}/{key}` from S3 → workspace dir, extract tar.gz.
 *      tar.gz must contain `dist/`, `migrations/`, `alepha.config.ts`
 *      (and typically `src/` + `package.json` — needed because
 *      `BuildCloudflareTask` boots Alepha to regenerate `wrangler.jsonc`).
 *   2. Write `.env.<env>.local` from the request's `config.vars` and
 *      `config.secrets`. The CLI picks these up on load; the alepha.config.ts
 *      can read `process.env.TENANT_SLUG` to parametrise per tenant.
 *   3. Spawn `npx alepha platform up --prebuilt --env <env>` in the
 *      workspace. Stdout + stderr are piped into the registry log buffer.
 *   4. On exit 0, parse the deployed URL from the output and mark
 *      `succeeded`. On non-zero, capture the tail of the log and mark
 *      `failed`.
 *   5. Always clean up the workspace + tar.gz (`ROCKET_DEBUG_RETAIN=1` to
 *      keep them for post-mortems).
 */
export class DeployRunner {
  protected readonly log = $logger();
  protected readonly registry = $inject(DeployRegistry);
  protected readonly artifacts = $inject(ArtifactService);

  public async run(id: string, body: CreateDeploy): Promise<void> {
    this.registry.start(id);

    const workspaceName = this.workspaceNameFor(body);
    const { workspace, cleanup } = await this.artifacts.fetch({
      deployId: workspaceName,
      bucket: body.artifact.bucket,
      key: body.artifact.key,
    });

    try {
      await this.writeEnvOverrides(id, workspace, body);
      this.registry.append(
        id,
        `> cd ${workspace}\n` +
          `> npx alepha platform ${body.op} --prebuilt --env ${body.env}\n\n`,
      );
      const deployedUrl = await this.runPlatform(id, body, workspace);
      this.registry.succeed(id, deployedUrl);
    } finally {
      if (!process.env.ROCKET_DEBUG_RETAIN) {
        await cleanup().catch((err) => {
          this.log.warn(`Failed to cleanup workspace for deploy ${id}`, err);
        });
      }
    }
  }

  /**
   * Workspace dir name. Derive from the artifact key so concurrent deploys
   * of *different* artifacts don't collide, and a redeploy of the same
   * artifact reuses the slot. Sanitise to a single path segment.
   */
  protected workspaceNameFor(body: CreateDeploy): string {
    const stem = body.artifact.key
      .replace(/\.tar\.gz$/i, "")
      .replace(/\.tgz$/i, "");
    return stem.replace(/[^a-zA-Z0-9._-]+/g, "-");
  }

  /**
   * Write `.env.<env>.local` from the request body. The Alepha CLI loads
   * `.env.<env>.local` after `.env.<env>` on startup; per-tenant overrides
   * land there. Vars + secrets share one file — the orchestrator's secrets
   * step filters which keys become worker secrets vs static vars.
   */
  protected async writeEnvOverrides(
    id: string,
    workspace: string,
    body: CreateDeploy,
  ): Promise<void> {
    const merged: Record<string, string> = {
      ...(body.config?.vars ?? {}),
      ...(body.config?.secrets ?? {}),
    };
    if (Object.keys(merged).length === 0) return;

    const lines = Object.entries(merged).map(
      ([k, v]) => `${k}=${JSON.stringify(v)}`,
    );
    const target = join(workspace, `.env.${body.env}.local`);
    await writeFile(target, `${lines.join("\n")}\n`, "utf-8");
    this.registry.append(
      id,
      `Wrote ${lines.length} override(s) to .env.${body.env}.local\n`,
    );
  }

  protected runPlatform(
    id: string,
    body: CreateDeploy,
    workspace: string,
  ): Promise<string | undefined> {
    return new Promise((resolve, reject) => {
      const args = [
        "alepha",
        "platform",
        body.op,
        "--prebuilt",
        "--env",
        body.env,
      ];

      const proc = spawn("npx", args, {
        cwd: workspace,
        env: {
          ...process.env,
          // CI=true → Runner uses plain-log mode (no spinner draws).
          CI: "true",
          // No NODE_ENV override — let the workspace's CLI pick its own
          // mode resolution (defaults to production for the `up` command).
        },
        stdio: ["ignore", "pipe", "pipe"],
      });

      let combined = "";
      const onChunk = (chunk: Buffer) => {
        const s = chunk.toString();
        combined += s;
        this.registry.append(id, s);
      };
      proc.stdout.on("data", onChunk);
      proc.stderr.on("data", onChunk);

      proc.on("error", (err) => reject(err));
      proc.on("exit", (code) => {
        if (code === 0) {
          resolve(this.parseDeployedUrl(combined));
        } else {
          reject(
            new Error(
              `alepha platform ${body.op} exited with code ${code ?? "?"}`,
            ),
          );
        }
      });
    });
  }

  /**
   * Pick the last `https://…` URL out of the CLI output — `alepha platform
   * up` prints a `→ https://example.com` line at the end. Returns undefined
   * if no URL is present (e.g. `migrate` or `secrets` ops).
   */
  protected parseDeployedUrl(output: string): string | undefined {
    const matches = output.match(/https:\/\/[\w.-]+(?:\/[\w./?#=&-]*)?/g);
    return matches?.[matches.length - 1];
  }
}
