/**
 * Where a project's git repositories live (#E162, folio #F1500, "One
 * interface, two backends"), substituted per runtime by `LoreBuildApi`:
 *
 * - {@link ArtifactsGitBackend} on the Worker: Cloudflare Artifacts, through
 *   the `ARTIFACTS` binding.
 * - {@link LocalGitBackend} on Node (the Docker image, `alepha dev`, every
 *   spec): bare repositories on disk, driven by the `git` binary.
 *
 * A repository is addressed by its `ref`, the name {@link GitBackend.refFor}
 * derives from the ids and the row stores as `backendRef`. Nothing here knows
 * a slug.
 */
export abstract class GitBackend {
  /**
   * Which backend this is, for logs and for the git route's choice between
   * proxying and spawning.
   */
  public abstract readonly kind: "artifacts" | "local";

  /**
   * The name a new repository takes in this backend, from ids only.
   */
  public abstract refFor(ids: { projectId: number; repoId: string }): string;

  /**
   * Create an empty repository whose HEAD names `defaultBranch`.
   */
  public abstract create(
    ref: string,
    options: { defaultBranch: string },
  ): Promise<void>;

  /**
   * Delete a repository. Deleting one that is already gone is not an error.
   */
  public abstract delete(ref: string): Promise<void>;

  /**
   * Every repository ref the backend holds, for a reconciliation or a check.
   */
  public abstract list(): Promise<string[]>;

  /**
   * What the backend knows about one repository, or undefined when it holds
   * none by that ref.
   */
  public abstract info(ref: string): Promise<GitRepositoryInfo | undefined>;

  /**
   * A credential for the backend's own git endpoint, for a proxy that talks
   * to it over HTTP. Undefined on a backend Lore serves in process.
   */
  public abstract token(
    ref: string,
    scope: GitTokenScope,
  ): Promise<GitBackendToken | undefined>;

  /**
   * The commits a ref update brought, newest first: from `to` back to, and
   * without, `from`, at most `limit` of them (#Q3945). Artifacts walks the
   * first-parent chain only, so a merge's second-parent commits are not
   * listed there; the bare repository lists every one.
   */
  public abstract commits(
    ref: string,
    range: { from: string; to: string; limit: number },
  ): Promise<GitCommit[]>;

  /**
   * Every branch and tag tip, plus `HEAD` when it resolves (#Q3946): what a
   * backup bundles, and what tells an unchanged repository from one that
   * moved. Empty for an empty repository.
   */
  public abstract refs(ref: string): Promise<GitRefTip[]>;

  /**
   * The whole repository as a git bundle (v2): a header naming `refs`, then
   * one packfile holding everything they reach (#Q3946). `git clone
   * <file>.bundle` reads it back.
   */
  public abstract bundle(
    ref: string,
    refs: GitRefTip[],
  ): Promise<ReadableStream<Uint8Array>>;

  /**
   * A bundle's header: the signature, a line per ref, a blank line. The
   * packfile follows.
   */
  public static bundleHeader(refs: GitRefTip[]): Uint8Array {
    return new TextEncoder().encode(
      `# v2 git bundle\n${refs.map((tip) => `${tip.sha} ${tip.name}\n`).join("")}\n`,
    );
  }

  /**
   * Answer one smart HTTP request for a repository: the ref advertisement
   * (`info/refs`) or an RPC (`git-upload-pack`, `git-receive-pack`). The
   * caller has authenticated, authorized and decompressed already.
   */
  public abstract serve(
    ref: string,
    rpc: GitRpcRequest,
  ): Promise<GitRpcResponse>;
}

/**
 * The two services of git smart HTTP.
 */
export type GitService = "git-upload-pack" | "git-receive-pack";

export interface GitRpcRequest {
  service: GitService;
  /**
   * `info/refs?service=...`, the advertisement, rather than the RPC.
   */
  advertise: boolean;
  /**
   * The RPC's request body, never gzipped: the route inflates it first.
   */
  body?: ReadableStream<Uint8Array>;
  /**
   * The `Git-Protocol` header, validated (`version=2`, ...).
   */
  gitProtocol?: string;
  userAgent?: string;
  /**
   * The repository's default branch, as Lore's row names it: a
   * receive-pack refuses a non-fast-forward of it (#Q3953). The bare
   * repository reads its own `HEAD` instead.
   */
  defaultBranch?: string;
  /**
   * Aborted when the client goes away: a spawned `git` is killed with it.
   */
  signal?: AbortSignal;
}

export interface GitRefTip {
  sha: string;
  /**
   * `HEAD`, `refs/heads/<name>` or `refs/tags/<name>`.
   */
  name: string;
}

export interface GitCommit {
  sha: string;
  message: string;
}

export interface GitRpcResponse {
  status: number;
  contentType?: string;
  body: ReadableStream<Uint8Array> | string;
}

/**
 * `read` for upload-pack (clone, fetch), `write` for receive-pack (push).
 */
export type GitTokenScope = "read" | "write";

export interface GitRepositoryInfo {
  ref: string;
  defaultBranch: string;
  /**
   * Bytes on disk, when the backend can tell. Artifacts does not say.
   */
  sizeBytes?: number;
}

export interface GitBackendToken {
  /**
   * The backend's smart HTTP base URL for this repository, `.../<name>.git`.
   */
  remote: string;
  /**
   * The repo-scoped token, sent as the Basic password.
   */
  token: string;
  /**
   * Epoch milliseconds.
   */
  expiresAt: number;
}
