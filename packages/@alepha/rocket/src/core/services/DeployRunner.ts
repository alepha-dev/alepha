import { spawn } from "node:child_process";
import { $inject } from "alepha";
import { $logger } from "alepha/logger";
import { DeployRegistry } from "../providers/DeployRegistry.ts";
import type { CreateDeploy } from "../schemas/deploy.ts";
import { ArtifactService } from "./ArtifactService.ts";

/**
 * Runs a single deploy run end-to-end.
 *
 * 1. Fetch the artifact from S3 → temp workspace.
 * 2. Spawn `npx alepha platform <op> -e <env>` against the workspace.
 * 3. Pipe stdout/stderr into the registry's log buffer.
 * 4. On exit 0: succeed. On non-zero: fail with the exit code +
 *    the tail of the log.
 * 5. Always cleanup the temp workspace.
 *
 * v1 keeps things simple — uses the artifact's bundled `alepha.config.ts`
 * as-is. `body.config` overrides (multi-tenant deploy path) are
 * deferred until a `ConfigService` lands in a follow-up.
 */
export class DeployRunner {
  protected readonly log = $logger();
  protected readonly registry = $inject(DeployRegistry);
  protected readonly artifacts = $inject(ArtifactService);

  public async run(id: string, body: CreateDeploy): Promise<void> {
    this.registry.start(id);
    const { workspace, cleanup } = await this.artifacts.fetch({
      deployId: id,
      bucket: body.artifact.bucket,
      key: body.artifact.key,
    });

    try {
      this.registry.append(id, `> alepha platform ${body.op} -e ${body.env}\n`);
      const deployedUrl = await this.runPlatform(id, body, workspace);
      this.registry.succeed(id, deployedUrl);
    } finally {
      await cleanup().catch((err) => {
        this.log.warn(`Failed to cleanup workspace for deploy ${id}`, err);
      });
    }
  }

  protected runPlatform(
    id: string,
    body: CreateDeploy,
    workspace: string,
  ): Promise<string | undefined> {
    return new Promise((resolve, reject) => {
      const args = ["alepha", "platform", body.op, "-e", body.env];
      // `--mode <env>` loads `.env.<env>` — pass the env name through so
      // the CLI behavior matches a local invocation.
      args.push("-m", body.env);

      const proc = spawn("npx", args, {
        cwd: workspace,
        env: {
          ...process.env,
          // CI=true forces the Runner into log-mode (no spinner draw).
          CI: "true",
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
   * Try to find a `https://…` URL in the CLI output — typically the
   * "→ https://example.com" line printed at the end of `up`. Returns
   * the last match if any; undefined otherwise.
   */
  protected parseDeployedUrl(output: string): string | undefined {
    const matches = output.match(/https:\/\/[\w.-]+(?:\/[\w./?#=&-]*)?/g);
    return matches?.[matches.length - 1];
  }
}
