import { $inject, Alepha, AlephaError } from "alepha";
import { DateTimeProvider } from "alepha/datetime";

import {
  GitBackend,
  type GitBackendToken,
  type GitCommit,
  type GitRefTip,
  type GitRepositoryInfo,
  type GitRpcRequest,
  type GitRpcResponse,
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
   * The binding's `log`, a page at a time from `to`, until `from`: newest
   * first along the first-parent chain, which is all `log` walks.
   *
   * When `from` is not met within `limit` (it sat on a second parent, or
   * the push was that large), nothing is answered: a list that is not the
   * push's own would record commits on quests it never named.
   */
  public async commits(
    ref: string,
    range: { from: string; to: string; limit: number },
  ): Promise<GitCommit[]> {
    const repo = await this.repo(ref);
    if (!repo?.log) return [];
    const found: GitCommit[] = [];
    const page = Math.min(range.limit, 1000);
    for (let offset = 0; offset < range.limit; offset += page) {
      const entries = await repo.log({ ref: range.to, limit: page, offset });
      for (const entry of entries) {
        if (entry.hash === range.from) return found;
        found.push({ sha: entry.hash, message: entry.message });
      }
      if (entries.length < page) break;
    }
    return [];
  }

  /**
   * The upload-pack advertisement, protocol v0, read for its ref lines.
   */
  public async refs(ref: string): Promise<GitRefTip[]> {
    const token = await this.token(ref, "read");
    if (!token) return [];
    const response = await this.fetchUpstream(
      `${token.remote}/info/refs?service=git-upload-pack`,
      { headers: { authorization: `Basic ${btoa(`x:${token.token}`)}` } },
    );
    if (!response.ok) {
      throw new AlephaError(
        `The advertisement of ${ref} answered ${response.status}`,
      );
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    return ArtifactsGitBackend.advertisedRefs(bytes);
  }

  /**
   * A full fetch over smart HTTP, as a clone makes, written as a bundle
   * (#Q3946): protocol v0, `want` every tip, `done`, and none of the
   * `side-band` capabilities, so the answer is `NAK` then the bare packfile.
   * The packfile streams through: the Worker never holds it.
   */
  public async bundle(
    ref: string,
    refs: GitRefTip[],
  ): Promise<ReadableStream<Uint8Array>> {
    const token = await this.token(ref, "read");
    if (!token) throw new AlephaError(`No repository ${ref} to bundle`);
    const wants = [...new Set(refs.map((tip) => tip.sha))];
    const pkt = (line: string) =>
      `${(line.length + 4).toString(16).padStart(4, "0")}${line}`;
    const request = [
      ...wants.map((sha, index) =>
        pkt(`want ${sha}${index === 0 ? " ofs-delta agent=lore" : ""}\n`),
      ),
      "0000",
      pkt("done\n"),
    ].join("");
    const response = await this.fetchUpstream(
      `${token.remote}/git-upload-pack`,
      {
        method: "POST",
        headers: {
          authorization: `Basic ${btoa(`x:${token.token}`)}`,
          "content-type": "application/x-git-upload-pack-request",
          accept: "application/x-git-upload-pack-result",
        },
        body: request,
      },
    );
    if (!response.ok || !response.body) {
      throw new AlephaError(`The fetch of ${ref} answered ${response.status}`);
    }
    return ArtifactsGitBackend.packAfterNak(
      GitBackend.bundleHeader(refs),
      response.body,
    );
  }

  /**
   * The `<sha> <name>` lines of a v0 advertisement: branches, tags and
   * `HEAD`, never a peeled `^{}` entry.
   */
  public static advertisedRefs(bytes: Uint8Array): GitRefTip[] {
    const decoder = new TextDecoder();
    const tips: GitRefTip[] = [];
    let offset = 0;
    while (offset + 4 <= bytes.length) {
      const length = Number.parseInt(
        decoder.decode(bytes.slice(offset, offset + 4)),
        16,
      );
      if (Number.isNaN(length)) break;
      if (length < 4) {
        offset += 4;
        continue;
      }
      const line = decoder
        .decode(bytes.slice(offset + 4, offset + length))
        .split("\0")[0]!
        .replace(/\n$/, "");
      offset += length;
      const match = /^([0-9a-f]{40}) (\S+)$/.exec(line);
      if (!match) continue;
      const [, sha, name] = match as unknown as [string, string, string];
      if (/^0+$/.test(sha) || name.endsWith("^{}")) continue;
      if (name === "HEAD" || /^refs\/(heads|tags)\//.test(name)) {
        tips.push({ sha, name });
      }
    }
    return tips;
  }

  /**
   * `header`, then the response's packfile: the pkt-lines before it
   * (`NAK`, `ACK`) are dropped, up to the `PACK` signature, and so is the
   * flush (`0000`) Artifacts writes after it, which `git index-pack` reads
   * as junk. The last four bytes are held back until the end for that.
   */
  public static packAfterNak(
    header: Uint8Array,
    body: ReadableStream<Uint8Array>,
  ): ReadableStream<Uint8Array> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer: Uint8Array = new Uint8Array(0);
    let started = false;
    let tail: Uint8Array = new Uint8Array(0);
    const concat = (a: Uint8Array, b: Uint8Array) => {
      const joined = new Uint8Array(a.length + b.length);
      joined.set(a);
      joined.set(b, a.length);
      return joined;
    };
    /**
     * Emit all but the last four bytes seen so far.
     */
    const emit = (
      controller: ReadableStreamDefaultController<Uint8Array>,
      chunk: Uint8Array,
    ) => {
      const all = concat(tail, chunk);
      const cut = Math.max(all.length - 4, 0);
      if (cut > 0) controller.enqueue(all.slice(0, cut));
      tail = all.slice(cut);
    };
    return new ReadableStream<Uint8Array>({
      start: (controller) => controller.enqueue(header),
      pull: async (controller) => {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) {
            if (!started) {
              controller.error(
                new AlephaError("The fetch answered no packfile"),
              );
              return;
            }
            if (decoder.decode(tail) !== "0000" && tail.length) {
              controller.enqueue(tail);
            }
            controller.close();
            return;
          }
          if (started) {
            emit(controller, value);
            return;
          }
          buffer = concat(buffer, value);
          let offset = 0;
          while (offset + 4 <= buffer.length) {
            if (decoder.decode(buffer.slice(offset, offset + 4)) === "PACK") {
              started = true;
              emit(controller, buffer.slice(offset));
              buffer = new Uint8Array(0);
              return;
            }
            const length = Number.parseInt(
              decoder.decode(buffer.slice(offset, offset + 4)),
              16,
            );
            if (Number.isNaN(length)) {
              controller.error(
                new AlephaError(
                  "The fetch answered something else than a pack",
                ),
              );
              return;
            }
            const size = length < 4 ? 4 : length;
            if (offset + size > buffer.length) break;
            offset += size;
          }
          buffer = buffer.slice(offset);
        }
      },
      cancel: (reason) => reader.cancel(reason),
    });
  }

  /**
   * Proxy the request to the repository's Artifacts remote with a cached
   * repo-scoped token, streaming both bodies: the Worker holds no pack in
   * memory and spends 0 to 4 ms of CPU per request (folio #F1527).
   */
  public async serve(ref: string, rpc: GitRpcRequest): Promise<GitRpcResponse> {
    const scope = rpc.service === "git-receive-pack" ? "write" : "read";
    const token = await this.token(ref, scope);
    if (!token) {
      return { status: 404, body: "Repository not found\n" };
    }
    const url = rpc.advertise
      ? `${token.remote}/info/refs?service=${rpc.service}`
      : `${token.remote}/${rpc.service}`;
    const headers: Record<string, string> = {
      authorization: `Basic ${btoa(`x:${token.token}`)}`,
    };
    if (rpc.gitProtocol) headers["git-protocol"] = rpc.gitProtocol;
    if (rpc.userAgent) headers["user-agent"] = rpc.userAgent;
    if (!rpc.advertise) {
      headers["content-type"] = `application/x-${rpc.service}-request`;
      headers.accept = `application/x-${rpc.service}-result`;
    }
    const upstream = await this.fetchUpstream(url, {
      method: rpc.advertise ? "GET" : "POST",
      headers,
      body: rpc.advertise ? undefined : rpc.body,
      signal: rpc.signal,
      // A streamed request body needs it on Node; workerd ignores it.
      duplex: "half",
    } as RequestInit);
    if (upstream.status === 401 || upstream.status === 403) {
      // A cached token Artifacts no longer takes: forget it, so the retry
      // git makes mints a fresh one.
      this.tokens.delete(`${ref}:${scope}`);
    }
    return {
      status: upstream.status,
      contentType: upstream.headers.get("content-type") ?? undefined,
      body: upstream.body ?? "",
    };
  }

  /**
   * The upstream call, on its own so a spec can substitute it.
   */
  protected fetchUpstream(url: string, init: RequestInit): Promise<Response> {
    return fetch(url, init);
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
  /**
   * Commits newest first along the first-parent chain from `ref`; an empty
   * array when the ref does not resolve.
   */
  log?(options: {
    ref?: string;
    limit?: number;
    offset?: number;
  }): Promise<Array<{ hash: string; message: string }>>;
  [Symbol.dispose]?: () => void;
}
