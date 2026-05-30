import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { $inject, Alepha, AlephaError } from "alepha";
import type { DetectedResources } from "alepha/cli/platform-lib";
import { PlatformOrchestrator } from "alepha/cli/platform-lib";
import { Runner } from "alepha/command";
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
 *      tar.gz must contain `dist/` (with `manifest.json`) and
 *      `migrations/`. No `alepha.config.ts` or `src/` is needed —
 *      `PlatformInspector` and the resource detector both read from
 *      `dist/manifest.json` in prebuilt mode.
 *   2. Write `.env.<env>.local` from the request's `config.vars` and
 *      `config.secrets`. The CLI picks these up on load; the alepha.config.ts
 *      can read `process.env.TENANT_SLUG` to parametrise per tenant.
 *   3. Call `PlatformOrchestrator.up()` in-process. Stdout + stderr are
 *      intercepted for the duration of the call and forwarded to the
 *      registry log buffer. No `npx alepha …` spawn, no workspace
 *      `npm install` — `alepha` itself is already bundled into Rocket's
 *      dist; the only external binary called is `wrangler` (by the
 *      Cloudflare adapter's build/deploy steps).
 *   4. On success, return the deployed URL and mark `succeeded`.
 *      On failure, capture the error and mark `failed`.
 *   5. Always clean up the workspace + tar.gz (`ROCKET_DEBUG_RETAIN=1` to
 *      keep them for post-mortems).
 */
export class DeployRunner {
  protected readonly log = $logger();
  protected readonly registry = $inject(DeployRegistry);
  protected readonly artifacts = $inject(ArtifactService);
  protected readonly orchestrator = $inject(PlatformOrchestrator);
  protected readonly runner = $inject(Runner);
  protected readonly alepha = $inject(Alepha);

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
        `> orchestrator.${body.op} { root: ${workspace}, env: ${body.env}, prebuilt: true }\n\n`,
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
   * Workspace dir name. Artifacts produced by `alepha pack` are named
   * `<project>-<version>.tar.gz` (default `<project>-latest.tar.gz`).
   * Strip the version suffix so different versions of the same project
   * deploy into the same `/app/workspace/<project>/` dir — keeps the
   * worker name (derived by BuildCloudflareTask from basename(root))
   * deterministic across redeploys.
   *
   * Slugified strictly — lowercase, alphanumeric + dashes only —
   * because wrangler rejects names with dots/uppercase/underscores.
   *
   * Examples:
   *   "club-0.0.2.tar.gz"      → "club"
   *   "lore-latest.tar.gz"     → "lore"
   *   "My.App-v3.tar.gz"       → "my-app"
   *   "no-version.tar.gz"      → "no-version"  (no `-` to split on)
   */
  protected workspaceNameFor(body: CreateDeploy): string {
    const stem = body.artifact.key
      .replace(/^.*\//, "") // drop bucket prefix if key includes slashes
      .replace(/\.tar\.gz$/i, "")
      .replace(/\.tgz$/i, "");
    const dash = stem.lastIndexOf("-");
    const name = dash > 0 ? stem.slice(0, dash) : stem;
    return name
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
   * Drive the orchestrator op (up or down) in-process. Streams
   * stdout/stderr — captured by interception — into the registry buffer
   * for the duration of the call.
   *
   * The orchestrator needs `entry` and `resources` per call; in prebuilt
   * mode they're read straight from `dist/manifest.json` (no Vite, no
   * AppEntryProvider).
   */
  protected async runPlatform(
    id: string,
    body: CreateDeploy,
    workspace: string,
  ): Promise<string | undefined> {
    const { entry, resources } = await this.readManifest(workspace);

    const restore = this.interceptStdio(id);
    try {
      this.runner.startCommand("alepha", `platform ${body.op}`);

      if (body.op === "up") {
        const result = await this.orchestrator.up({
          root: workspace,
          env: body.env,
          entry,
          resources,
          run: this.runner.run,
          prebuilt: true,
          tenant: body.tenant,
        });
        this.orchestrator.printUpSummary(result);
        return result.domain ? `https://${result.domain}` : result.urls[0];
      }

      // down — auto-confirm; the POST /deploys is itself the confirmation.
      await this.orchestrator.down({
        root: workspace,
        env: body.env,
        entry,
        resources,
        run: this.runner.run,
        tenant: body.tenant,
        confirm: async () => body.env,
      });
      return undefined;
    } finally {
      restore();
    }
  }

  /**
   * Read `dist/manifest.json` produced by `alepha build`. Returns the
   * synthetic `AppEntry` + the `DetectedResources` captured at build
   * time so the orchestrator can skip Vite introspection (it'd need
   * the workspace's runtime deps, which the prebuilt tarball doesn't
   * ship).
   */
  protected async readManifest(workspace: string): Promise<{
    entry: { root: string; server: string };
    resources: DetectedResources;
  }> {
    const path = join(workspace, "dist", "manifest.json");
    try {
      const raw = await readFile(path, "utf-8");
      const manifest = JSON.parse(raw) as { resources?: DetectedResources };
      if (!manifest.resources) {
        throw new AlephaError(`manifest.json missing "resources" at ${path}`);
      }
      return {
        entry: { root: workspace, server: "" },
        resources: manifest.resources,
      };
    } catch (err) {
      throw new AlephaError(
        `Failed to read ${path}: ${(err as Error).message}`,
      );
    }
  }

  /**
   * Capture process.stdout / process.stderr writes into the registry's
   * log buffer for the active deploy. Returns a `restore` function the
   * caller MUST invoke (in a finally block) to put the original writers
   * back. Concurrent deploys share `process.stdout`, so callers must
   * serialize — DeployRegistry processes one deploy at a time.
   */
  protected interceptStdio(id: string): () => void {
    const out = process.stdout.write.bind(process.stdout);
    const err = process.stderr.write.bind(process.stderr);

    const sink = (chunk: any) => {
      const s = typeof chunk === "string" ? chunk : (chunk?.toString?.() ?? "");
      if (s) this.registry.append(id, s);
    };

    process.stdout.write = ((chunk: any, ...rest: any[]) => {
      sink(chunk);
      return out(chunk, ...(rest as []));
    }) as typeof process.stdout.write;

    process.stderr.write = ((chunk: any, ...rest: any[]) => {
      sink(chunk);
      return err(chunk, ...(rest as []));
    }) as typeof process.stderr.write;

    return () => {
      process.stdout.write = out;
      process.stderr.write = err;
    };
  }
}
