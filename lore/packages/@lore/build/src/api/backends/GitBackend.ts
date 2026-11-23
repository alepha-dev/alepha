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
   * The commit a revision names (#Q4131): a branch (`main`,
   * `refs/heads/main`), a tag, lightweight or annotated (peeled to its
   * commit), `HEAD`, or a full 40-character commit sha. Undefined when it
   * names nothing. A branch wins over a tag of the same name, on both
   * backends. A short sha is the service's business (the commit index).
   */
  public abstract resolve(
    ref: string,
    revision: string,
  ): Promise<string | undefined>;

  /**
   * One level of the tree at `path` in `commit` (the root when `path` is
   * empty), in git's order. Undefined when the commit or the path is
   * missing, or when the path is not a directory.
   */
  public abstract tree(
    ref: string,
    commit: string,
    path: string,
  ): Promise<GitTreeEntry[] | undefined>;

  /**
   * One blob by its sha, its size checked before a byte is read:
   * over `maxBytes` (default {@link GitBackend.DEFAULT_MAX_BYTES}) it
   * answers `too_large` and the bytes never reach memory.
   */
  public abstract blob(
    ref: string,
    sha: string,
    options?: GitReadOptions,
  ): Promise<GitBlobResult>;

  /**
   * The blob at `path` in `commit`, as {@link GitBackend.blob} answers it.
   * A directory or a submodule is `not_found`.
   */
  public abstract file(
    ref: string,
    commit: string,
    path: string,
    options?: GitReadOptions,
  ): Promise<GitBlobResult>;

  /**
   * One commit, its parents, tree, author, committer and message, or
   * undefined when the repository holds no commit by that sha.
   */
  public abstract commit(
    ref: string,
    sha: string,
  ): Promise<GitCommitDetail | undefined>;

  /**
   * The best common ancestor of two commits, undefined when they share
   * none. `cap` when the walk read more than `maxReads` commits first (a
   * backend that asks git answers without one).
   */
  public abstract mergeBase(
    ref: string,
    a: string,
    b: string,
    options?: { maxReads?: number },
  ): Promise<{ kind: "ok"; sha: string | undefined } | { kind: "cap" }>;

  /**
   * Whether `ancestor` is reachable from `tip` (a commit is its own
   * ancestor), or `cap` when the walk ran out of `maxReads` first.
   */
  public abstract isAncestor(
    ref: string,
    ancestor: string,
    tip: string,
    options?: { maxReads?: number },
  ): Promise<{ kind: "ok"; value: boolean } | { kind: "cap" }>;

  /**
   * The bytes a blob read holds at most unless the caller says otherwise:
   * Artifacts refuses to read a blob over 32 MiB anyway (`MEMORY_LIMIT`).
   */
  public static readonly DEFAULT_MAX_BYTES = 8 * 1024 * 1024;

  /**
   * How many bytes the binary check reads, as git does.
   */
  public static readonly BINARY_PROBE_BYTES = 8000;

  /**
   * A full commit sha, the only kind a backend resolves by itself.
   */
  public static isSha(value: string): boolean {
    return /^[0-9a-f]{40}$/.test(value);
  }

  /**
   * The full ref names a short revision may mean, in the order both
   * backends try them: itself when it is one, then a branch, then a tag.
   * Nothing for a name git would refuse (`..`, `@{`, a leading `-`, ...).
   */
  public static refCandidates(revision: string): string[] {
    if (
      !revision ||
      revision.startsWith("-") ||
      revision.startsWith("/") ||
      revision.endsWith("/") ||
      revision.endsWith(".lock") ||
      revision.includes("..") ||
      revision.includes("@{") ||
      revision.includes("//") ||
      GitBackend.hasRefRefusedChar(revision)
    ) {
      return [];
    }
    if (revision === "HEAD") return ["HEAD"];
    if (revision.startsWith("refs/")) return [revision];
    return [`refs/heads/${revision}`, `refs/tags/${revision}`];
  }

  /**
   * A control character, a space, or one of `~^:?*[\\`: what
   * `git check-ref-format` refuses in a ref name.
   */
  protected static hasRefRefusedChar(name: string): boolean {
    for (let i = 0; i < name.length; i++) {
      const code = name.charCodeAt(i);
      if (code <= 0x20 || code === 0x7f || "~^:?*[\\".includes(name[i]!)) {
        return true;
      }
    }
    return false;
  }

  /**
   * A repository path as git takes it: no leading or trailing slash, no
   * `.` or `..` segment. Undefined when it cannot be one.
   */
  public static cleanPath(path: string): string | undefined {
    const clean = path.replace(/^\/+|\/+$/g, "");
    if (!clean) return "";
    const segments = clean.split("/");
    if (
      segments.some(
        (segment) => segment === "" || segment === "." || segment === "..",
      ) ||
      clean.includes("\0")
    ) {
      return undefined;
    }
    return clean;
  }

  /**
   * Binary as git tells it: a NUL byte in the first 8,000.
   */
  public static isBinary(bytes: Uint8Array): boolean {
    const end = Math.min(bytes.length, GitBackend.BINARY_PROBE_BYTES);
    for (let i = 0; i < end; i++) {
      if (bytes[i] === 0) return true;
    }
    return false;
  }

  /**
   * A blob read's answer once its size is known: `too_large` over the
   * budget, else the bytes `read` brings.
   */
  public static async sized(
    size: number,
    maxBytes: number | undefined,
    read: () => Promise<Uint8Array>,
  ): Promise<GitBlobResult> {
    if (size > (maxBytes ?? GitBackend.DEFAULT_MAX_BYTES)) {
      return { kind: "too_large", size };
    }
    const bytes = await read();
    return {
      kind: "ok",
      bytes,
      size: bytes.length,
      binary: GitBackend.isBinary(bytes),
    };
  }

  /**
   * A commit message's subject and body, as git's `%s` and `%b` cut them:
   * the subject is the first paragraph on one line, the body what follows
   * the first blank line. The message has its trailing newlines dropped.
   */
  public static splitMessage(raw: string): {
    message: string;
    subject: string;
    body: string;
  } {
    const message = raw.replace(/\r\n/g, "\n").replace(/\n+$/, "");
    const at = message.search(/\n[ \t]*\n/);
    const head = at === -1 ? message : message.slice(0, at);
    const body = at === -1 ? "" : message.slice(at).replace(/^\s*\n/, "");
    return {
      message,
      subject: head
        .split("\n")
        .map((line) => line.trim())
        .join(" ")
        .trim(),
      body: body.replace(/\s+$/, ""),
    };
  }

  /**
   * The merge base by walking commits newest first from both sides,
   * painting each with the side that reached it, as git's
   * `paint_down_to_common` does: a commit reached from both is a common
   * ancestor, its own ancestors are stale, and the walk stops when only
   * stale commits are left. For a backend that can read one commit at a
   * time and nothing more (Artifacts).
   */
  public static async paintMergeBase(
    read: (sha: string) => Promise<GitWalkCommit | undefined>,
    a: string,
    b: string,
    maxReads: number,
  ): Promise<{ kind: "ok"; sha: string | undefined } | { kind: "cap" }> {
    if (a === b) return { kind: "ok", sha: a };
    const SIDE_A = 1;
    const SIDE_B = 2;
    const STALE = 4;
    const flags = new Map<string, number>();
    const commits = new Map<string, GitWalkCommit>();
    let reads = 0;
    const load = async (sha: string) => {
      const known = commits.get(sha);
      if (known) return known;
      reads += 1;
      const commit = await read(sha);
      if (commit) commits.set(sha, commit);
      return commit;
    };
    const queue: string[] = [];
    const push = (sha: string) => {
      if (!queue.includes(sha)) queue.push(sha);
    };
    for (const [sha, side] of [
      [a, SIDE_A],
      [b, SIDE_B],
    ] as const) {
      if (!(await load(sha))) return { kind: "ok", sha: undefined };
      flags.set(sha, (flags.get(sha) ?? 0) | side);
      push(sha);
    }
    const found: string[] = [];
    while (queue.some((sha) => !((flags.get(sha) ?? 0) & STALE))) {
      if (reads > maxReads) return { kind: "cap" };
      queue.sort(
        (x, y) =>
          (commits.get(y)?.committedAt ?? 0) -
          (commits.get(x)?.committedAt ?? 0),
      );
      const sha = queue.shift()!;
      let flag = flags.get(sha) ?? 0;
      if ((flag & (SIDE_A | SIDE_B)) === (SIDE_A | SIDE_B)) {
        if (!(flag & STALE) && !found.includes(sha)) found.push(sha);
        flag |= STALE;
      }
      const commit = commits.get(sha);
      for (const parent of commit?.parents ?? []) {
        const before = flags.get(parent) ?? 0;
        const after = before | flag;
        if (after === before) continue;
        if (!(await load(parent))) continue;
        flags.set(parent, after);
        push(parent);
      }
    }
    // Newest first: a criss-cross merge has two equally good bases, and
    // git answers one of them too.
    return { kind: "ok", sha: found[0] };
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
  /**
   * The commit an annotated tag points at, peeled (`<tag>^{}`): `sha` is
   * the tag object's own (#Q4131). Absent on a branch and on a lightweight
   * tag, whose `sha` is the commit already.
   */
  targetSha?: string;
}

/**
 * One entry of a tree, one level deep (#Q4131).
 */
export interface GitTreeEntry {
  name: string;
  /**
   * git's mode, as git writes it: `100644`, `100755`, `120000` (a symlink),
   * `40000` (a tree), `160000` (a submodule).
   */
  mode: string;
  /**
   * `blob` for a file or a symlink, `tree` for a directory, `commit` for a
   * submodule.
   */
  type: "blob" | "tree" | "commit";
  sha: string;
}

export interface GitReadOptions {
  /**
   * The most bytes to read: a bigger blob answers `too_large`.
   */
  maxBytes?: number;
}

/**
 * A blob read: its bytes, or why there are none.
 */
export type GitBlobResult =
  | { kind: "ok"; bytes: Uint8Array; size: number; binary: boolean }
  | { kind: "too_large"; size: number }
  | { kind: "not_found" };

export interface GitPerson {
  name: string;
  email: string;
  /**
   * Epoch seconds, as git records it.
   */
  at: number;
}

/**
 * One commit read in full (#Q4131).
 */
export interface GitCommitDetail {
  sha: string;
  /**
   * In git's order: the first parent first, none for a root commit.
   */
  parents: string[];
  treeSha: string;
  author: GitPerson;
  committer: GitPerson;
  subject: string;
  body: string;
  /**
   * The whole message, its trailing newlines dropped.
   */
  message: string;
}

/**
 * What a merge-base walk needs of a commit.
 */
export interface GitWalkCommit {
  parents: string[];
  committedAt: number;
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
