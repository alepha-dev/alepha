import { $inject, Alepha, AlephaError } from "alepha";
import { DateTimeProvider } from "alepha/datetime";

import {
  GitBackend,
  type GitBackendToken,
  type GitRepositoryInfo,
  type GitTokenScope,
} from "./GitBackend.ts";

/**
 * Cloudflare Artifacts, for Lore on its Worker (#E162, folio #F1527).
 *
 * Reaches the namespace through the `ARTIFACTS` binding `alepha.config.ts`
 * declares (`artifacts: [{ binding: "ARTIFACTS", namespace: "lore-production" }]`).
 * The binding exists only inside the Worker: on Node this class is never
 * constructed, and a spec that needs it hands a fake binding through
 * `cloudflare.env`.
 *
 * ## Named by id
 *
 * `<projectId>-<repoId>`, never the slug: a deleted Artifacts name cannot be
 * created again for a while (`create` answers "already exists" while `get`
 * answers "not found"), so a name is never reused.
 *
 * ## Tokens are cached
 *
 * Minting costs 100 to 125 ms (`get` + `info` + `createToken`), and a clone
 * is three requests. One token per repository and scope is kept for
 * {@link ArtifactsGitBackend.TOKEN_REUSE_MS}, minted for
 * {@link ArtifactsGitBackend.TOKEN_TTL_S}, with the remote beside it. The
 * cache is per isolate; a cold isolate mints once.
 */
export class ArtifactsGitBackend extends GitBackend {
  public readonly kind = "artifacts";
  protected readonly alepha = $inject(Alepha);
  protected readonly dateTime = $inject(DateTimeProvider);
  protected readonly tokens = new Map<string, GitBackendToken>();

  /**
   * The binding's name in the Worker's env.
   */
  public static readonly BINDING = "ARTIFACTS";

  /**
   * What a minted token lives, in seconds: Artifacts' own unit.
   */
  public static readonly TOKEN_TTL_S = 900;

  /**
   * How long a cached token is handed out: well inside its TTL, so a long
   * clone that starts on a reused token never sees it expire.
   */
  public static readonly TOKEN_REUSE_MS = 10 * 60 * 1000;

  public refFor(ids: { projectId: number; repoId: string }): string {
    return `${ids.projectId}-${ids.repoId}`;
  }

  public async create(
    ref: string,
    options: { defaultBranch: string },
  ): Promise<void> {
    await this.binding().create(ref, {
      setDefaultBranch: options.defaultBranch,
    });
  }

  public async delete(ref: string): Promise<void> {
    for (const scope of ["read", "write"]) {
      this.tokens.delete(`${ref}:${scope}`);
    }
    try {
      await this.binding().delete(ref);
    } catch (error) {
      if (this.codeOf(error) !== "NOT_FOUND") throw error;
    }
  }

  public async list(): Promise<string[]> {
    const refs: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await this.binding().list(cursor ? { cursor } : undefined);
      refs.push(...page.repos.map((repo) => repo.name));
      cursor = page.cursor;
    } while (cursor);
    return refs.sort();
  }

  public async info(ref: string): Promise<GitRepositoryInfo | undefined> {
    const repo = await this.repo(ref);
    if (!repo) return undefined;
    try {
      const info = await repo.info();
      return { ref, defaultBranch: info.defaultBranch };
    } finally {
      repo[Symbol.dispose]?.();
    }
  }

  public async token(
    ref: string,
    scope: GitTokenScope,
  ): Promise<GitBackendToken | undefined> {
    const key = `${ref}:${scope}`;
    const now = this.dateTime.nowMillis();
    const cached = this.tokens.get(key);
    if (cached && cached.expiresAt > now) {
      return cached;
    }
    const repo = await this.repo(ref);
    if (!repo) return undefined;
    try {
      const [info, minted] = await Promise.all([
        repo.info(),
        repo.createToken(scope, ArtifactsGitBackend.TOKEN_TTL_S),
      ]);
      const token: GitBackendToken = {
        remote: info.remote,
        token: minted.plaintext,
        expiresAt: now + ArtifactsGitBackend.TOKEN_REUSE_MS,
      };
      this.tokens.set(key, token);
      return token;
    } finally {
      repo[Symbol.dispose]?.();
    }
  }

  /**
   * A handle on one repository, or undefined when the namespace holds none
   * by that name.
   */
  protected async repo(ref: string): Promise<ArtifactsRepoHandle | undefined> {
    try {
      return await this.binding().get(ref);
    } catch (error) {
      if (this.codeOf(error) === "NOT_FOUND") return undefined;
      throw error;
    }
  }

  /**
   * The binding, out of the Worker's env, or a refusal that names it.
   */
  protected binding(): ArtifactsBinding {
    const env = this.alepha.store.get("cloudflare.env" as never) as
      | Record<string, unknown>
      | undefined;
    const binding = env?.[ArtifactsGitBackend.BINDING] as
      | ArtifactsBinding
      | undefined;
    if (!binding) {
      throw new AlephaError(
        `The Artifacts binding ${ArtifactsGitBackend.BINDING} is missing from the Worker's env: declare it in build.cloudflare.config.artifacts.`,
      );
    }
    return binding;
  }

  protected codeOf(error: unknown): string | undefined {
    const code = (error as { code?: unknown } | undefined)?.code;
    if (typeof code === "string") return code;
    const message = error instanceof Error ? error.message : String(error);
    return /not found/i.test(message) ? "NOT_FOUND" : undefined;
  }
}

/**
 * The part of Cloudflare's `Artifacts` binding this backend calls, typed
 * here rather than through `@cloudflare/workers-types`, which Lore's
 * packages do not load.
 */
export interface ArtifactsBinding {
  create(
    name: string,
    options?: { setDefaultBranch?: string; description?: string },
  ): Promise<{ name: string; remote: string; token: string }>;
  get(name: string): Promise<ArtifactsRepoHandle>;
  list(options?: {
    cursor?: string;
    limit?: number;
  }): Promise<{ repos: Array<{ name: string }>; cursor?: string }>;
  delete(name: string): Promise<unknown>;
}

export interface ArtifactsRepoHandle {
  info(): Promise<{ defaultBranch: string; remote: string }>;
  createToken(
    scope: "read" | "write",
    ttl: number,
  ): Promise<{ plaintext: string; expiresAt: string }>;
  [Symbol.dispose]?: () => void;
}
