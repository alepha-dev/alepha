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
      await this.installDeps(id, workspace);
      this.registry.append(
        id,
        `> cd ${workspace}\n` +
          `> npx alepha platform ${body.op} --prebuilt --json --env ${body.env}\n\n`,
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
   * Workspace dir name. Derive from the artifact key so concurrent
   * deploys of *different* artifacts don't collide, and a redeploy of
   * the same artifact reuses the slot.
   *
   * Slugified strictly — lowercase, alphanumeric + dashes only — because
   * `BuildCloudflareTask` currently derives the worker name from
   * `basename(root)` (no slugify), and wrangler rejects names with dots
   * or uppercase. Stripping characters here avoids that downstream
   * failure even for artifact keys like `club-0.0.2.tar.gz`.
   */
  protected workspaceNameFor(body: CreateDeploy): string {
    const stem = body.artifact.key
      .replace(/\.tar\.gz$/i, "")
      .replace(/\.tgz$/i, "");
    return stem
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 63);
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

  /**
   * Install the workspace's npm deps before invoking `alepha platform`.
   *
   * The CLI's `analyze app` step (which runs even in `--prebuilt` mode
   * to regenerate `wrangler.jsonc` from the actual primitives) boots
   * the workspace's source, which transitively imports its deps (e.g.
   * `react` from `alepha/react/core`). The image's `/app/node_modules/`
   * only has `alepha` + `wrangler` baked in; the workspace's own deps
   * are not, so we install them on first deploy.
   *
   * `--omit=dev` skips devDeps (vite, playwright, etc.) — only runtime
   * deps are needed.
   */
  protected installDeps(id: string, workspace: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.registry.append(id, "> npm install --omit=dev\n");
      const proc = spawn(
        "npm",
        ["install", "--omit=dev", "--no-fund", "--no-audit"],
        {
          cwd: workspace,
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      const onChunk = (chunk: Buffer) => {
        this.registry.append(id, chunk.toString());
      };
      proc.stdout.on("data", onChunk);
      proc.stderr.on("data", onChunk);
      proc.on("error", reject);
      proc.on("exit", (code) => {
        if (code === 0) {
          this.registry.append(id, "\n");
          resolve();
        } else {
          reject(new Error(`npm install exited with code ${code ?? "?"}`));
        }
      });
    });
  }

  protected runPlatform(
    id: string,
    body: CreateDeploy,
    workspace: string,
  ): Promise<string | undefined> {
    return new Promise((resolve, reject) => {
      // `down` doesn't need a build, doesn't read a dist/. The rest
      // (up / migrate / secrets) does — and `--prebuilt` keeps the
      // wrangler.jsonc regen fast.
      const args = ["alepha", "platform", body.op];
      if (body.op !== "down") {
        args.push("--prebuilt");
      }
      args.push("--json", "--env", body.env);
      if (body.op === "down") {
        // Non-interactive — Rocket can't answer prompts. The caller
        // committed to the destructive op by hitting POST /deploys.
        args.push("--yes");
      }

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
   * Pick the last `{...}` JSON object out of the CLI output and pull
   * out `urls[0]` or `domain` if present. The `--json` flag on
   * `alepha platform up` emits a single object on its own line; we
   * scan from the end to skip any stdout noise from earlier steps.
   * Falls back to URL-regex if no JSON object is found.
   */
  protected parseDeployedUrl(output: string): string | undefined {
    const lines = output.trim().split("\n");
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i].trim();
      if (!line.startsWith("{")) continue;
      // The CLI emits pretty JSON (multi-line). Walk backwards collecting
      // lines until braces balance — quick + good enough.
      let chunk = line;
      let depth = countDepth(chunk);
      let j = i - 1;
      while (depth > 0 && j >= 0) {
        chunk = `${lines[j]}\n${chunk}`;
        depth = countDepth(chunk);
        j--;
      }
      try {
        const parsed = JSON.parse(chunk) as {
          urls?: string[];
          domain?: string;
        };
        if (parsed?.urls?.[0]) return parsed.urls[0];
        if (parsed?.domain) return `https://${parsed.domain}`;
      } catch {
        // ignore, fall through to regex
      }
      break;
    }
    const matches = output.match(/https:\/\/[\w.-]+(?:\/[\w./?#=&-]*)?/g);
    return matches?.[matches.length - 1];
  }
}

function countDepth(s: string): number {
  let depth = 0;
  for (const c of s) {
    if (c === "{") depth++;
    else if (c === "}") depth--;
  }
  return depth;
}
