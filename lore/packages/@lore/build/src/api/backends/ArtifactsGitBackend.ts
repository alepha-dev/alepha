import { $inject, Alepha, AlephaError } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $logger } from "alepha/logger";

import {
  type GitRefCommand,
  GitReceivePack,
} from "../services/GitReceivePack.ts";
import {
  GitBackend,
  type GitBackendToken,
  type GitBlobResult,
  type GitCommit,
  type GitCommitDetail,
  type GitReadOptions,
  type GitRefTip,
  type GitTreeEntry,
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
 *
 * ## The default branch only moves forward
 *
 * Artifacts takes a force-push on any branch and has no setting against it
 * (#Q3953), and the Worker cannot tell a fast-forward from the ref commands
 * alone: the new commits arrive in the pack. So a push that moves the
 * default branch lands on `refs/lore/incoming/<uuid>` first, the ancestry is
 * read back through the binding, and only a fast-forward moves the branch,
 * by a command-only receive-pack that Artifacts itself refuses when the
 * branch moved meanwhile ("stale ref"). See {@link ArtifactsGitBackend.guardedPush}.
 */
export class ArtifactsGitBackend extends GitBackend {
  public readonly kind = "artifacts";
  protected readonly alepha = $inject(Alepha);
  protected readonly dateTime = $inject(DateTimeProvider);
  protected readonly tokens = new Map<string, GitBackendToken>();
  protected readonly receivePack = $inject(GitReceivePack);
  protected readonly log = $logger();

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
   * `HEAD`. A peeled `<tag>^{}` line is no tip of its own: it sets the
   * annotated tag's `targetSha` (#Q4131).
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
      if (/^0+$/.test(sha)) continue;
      if (name.endsWith("^{}")) {
        const tag = tips.find((tip) => tip.name === name.slice(0, -3));
        if (tag) tag.targetSha = sha;
        continue;
      }
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
   * Proxy the request to Artifacts ({@link ArtifactsGitBackend.proxy}),
   * through {@link ArtifactsGitBackend.guardedPush} for a push that may move
   * the default branch.
   */
  public async serve(ref: string, rpc: GitRpcRequest): Promise<GitRpcResponse> {
    if (
      rpc.service === "git-receive-pack" &&
      !rpc.advertise &&
      rpc.body &&
      rpc.defaultBranch
    ) {
      return this.guardedPush(ref, rpc, rpc.defaultBranch);
    }
    return this.proxy(ref, rpc);
  }

  /**
   * Where a push's update of the default branch waits for its ancestry
   * check. Outside `refs/heads` and `refs/tags`, so no clone fetches it.
   */
  public static readonly INCOMING_PREFIX = "refs/lore/incoming/";

  /**
   * The most commits read one by one (`readCommit`) to prove a fast-forward
   * the first `log` page did not: past it the push is refused, as unproven.
   */
  public static readonly MAX_COMMIT_READS = 2000;

  /**
   * How much older than the old tip a commit may be dated and still be
   * walked: committer clocks drift, and the walk stops below this.
   */
  public static readonly CLOCK_SLOP_S = 24 * 60 * 60;

  /**
   * A packfile of no object: `PACK`, version 2, a count of 0, then the
   * SHA-1 of those 12 bytes.
   */
  public static readonly EMPTY_PACK = new Uint8Array([
    0x50, 0x41, 0x43, 0x4b, 0, 0, 0, 2, 0, 0, 0, 0, 0x02, 0x9d, 0x08, 0x82,
    0x3b, 0xd8, 0xa8, 0xea, 0xb5, 0x10, 0xad, 0x6a, 0xc7, 0x5c, 0x82, 0x3c,
    0xfd, 0x3e, 0xd3, 0x1e,
  ]);

  /**
   * A receive-pack that may move the default branch (#Q3953).
   *
   * 1. The command for the default branch (neither a creation nor a
   *    deletion) is forwarded as the creation of a ref under
   *    {@link ArtifactsGitBackend.INCOMING_PREFIX}; the pack streams
   *    through unchanged, and the client's report capabilities are kept,
   *    `report-status-v2` read as `report-status`, whose lines it accepts.
   * 2. Once Artifacts reports it `ok`, {@link ArtifactsGitBackend.ancestry}
   *    tells whether the old tip is an ancestor of the new one.
   * 3. A fast-forward moves the branch from the old id to the new one and
   *    deletes the incoming ref, in one command-only receive-pack; anything
   *    else only deletes the incoming ref.
   * 4. The client gets Artifacts' report with the incoming ref's line
   *    replaced by the default branch's own.
   *
   * An `atomic` push of several refs stays atomic up to step 1: its other
   * refs have landed when the default branch is refused at step 2.
   */
  protected async guardedPush(
    ref: string,
    rpc: GitRpcRequest,
    defaultBranch: string,
  ): Promise<GitRpcResponse> {
    const head = `refs/heads/${defaultBranch}`;
    const incoming = `${ArtifactsGitBackend.INCOMING_PREFIX}${crypto.randomUUID()}`;
    // Set by the rewrite, which `inspect` calls before it answers.
    const seen: { guarded?: GitRefCommand; capabilities: string[] } = {
      capabilities: [],
    };
    const inspected = await this.receivePack.inspect(
      rpc.body!,
      (commands, capabilities) => {
        seen.capabilities = capabilities;
        const guarded = commands.find(
          (command) =>
            command.ref === head &&
            command.oldId !== GitReceivePack.ZERO &&
            command.newId !== GitReceivePack.ZERO &&
            command.oldId !== command.newId,
        );
        seen.guarded = guarded;
        if (!guarded) return undefined;
        return {
          commands: commands.map((command) =>
            command === guarded
              ? {
                  oldId: GitReceivePack.ZERO,
                  newId: command.newId,
                  ref: incoming,
                }
              : command,
          ),
          capabilities: [
            ...capabilities.filter(
              (it) => it !== "report-status" && it !== "report-status-v2",
            ),
            "report-status",
          ],
        };
      },
    );
    const command = seen.guarded;
    const clientCaps = seen.capabilities;
    if (!command) {
      return this.proxy(ref, { ...rpc, body: inspected.body });
    }
    const upstream = await this.proxy(ref, { ...rpc, body: inspected.body });
    if (upstream.status !== 200 || typeof upstream.body === "string") {
      return upstream;
    }
    const bytes = new Uint8Array(
      await new Response(upstream.body).arrayBuffer(),
    );
    const forwardedCaps = clientCaps.filter((it) => it !== "report-status-v2");
    const report = this.receivePack.decodeReport(bytes, [
      ...forwardedCaps,
      "report-status",
    ]);
    let verdict = `ng ${head} the push did not report the default branch`;
    const landed = report.lines.find((line) =>
      line.startsWith(`ok ${incoming}`),
    );
    const refused = report.lines.find((line) =>
      line.startsWith(`ng ${incoming} `),
    );
    if (refused) {
      verdict = `ng ${head} ${refused.slice(`ng ${incoming} `.length)}`;
    } else if (landed) {
      verdict = await this.settle(ref, command, incoming, defaultBranch);
    }
    const lines = report.lines.map((line) =>
      line.startsWith(`ok ${incoming}`) || line.startsWith(`ng ${incoming} `)
        ? verdict
        : line,
    );
    const wantsReport =
      clientCaps.includes("report-status") ||
      clientCaps.includes("report-status-v2");
    return {
      status: 200,
      contentType: upstream.contentType,
      body: new Response(
        this.receivePack.encodeReport(
          wantsReport ? lines : undefined,
          clientCaps,
          report.progress,
        ) as BodyInit,
      ).body!,
    };
  }

  /**
   * Steps 2 and 3 of {@link ArtifactsGitBackend.guardedPush}: the
   * default branch's report line once the incoming ref holds the new tip.
   */
  protected async settle(
    ref: string,
    command: GitRefCommand,
    incoming: string,
    defaultBranch: string,
  ): Promise<string> {
    const head = `refs/heads/${defaultBranch}`;
    let forward: boolean | undefined;
    try {
      forward = await this.ancestry(ref, command.oldId, command.newId);
    } catch (error) {
      this.log.warn("The fast-forward check failed", { ref, error });
    }
    const commands: GitRefCommand[] = [
      { oldId: command.newId, newId: GitReceivePack.ZERO, ref: incoming },
    ];
    if (forward) commands.unshift({ ...command });
    let lines: string[] = [];
    try {
      lines = await this.updateRefs(ref, commands);
    } catch (error) {
      this.log.warn("The incoming ref could not be settled", {
        ref,
        incoming,
        error,
      });
    }
    if (!lines.some((line) => line === `ok ${incoming}`)) {
      this.log.warn("The incoming ref was left behind", { ref, incoming });
    }
    if (forward === false) {
      return `ng ${head} the default branch ${defaultBranch} refuses a non-fast-forward push: pull, then push again`;
    }
    if (forward === undefined) {
      return `ng ${head} Lore could not prove this push a fast-forward of ${defaultBranch}: pull, then push again`;
    }
    const moved = lines.find(
      (line) => line === `ok ${head}` || line.startsWith(`ng ${head} `),
    );
    return moved ?? `ng ${head} the default branch could not be moved`;
  }

  /**
   * A receive-pack of commands alone, every object being there already,
   * answering its report lines. An update carries
   * {@link ArtifactsGitBackend.EMPTY_PACK}, as a git client sends: git's
   * receive-pack refuses one without, Artifacts takes both. Artifacts
   * refuses a command whose old id is not the ref's current one ("stale
   * ref").
   */
  protected async updateRefs(
    ref: string,
    commands: GitRefCommand[],
  ): Promise<string[]> {
    const caps = ["report-status", "delete-refs", "agent=lore"];
    const body = new Blob([
      ...commands.map((command, index) =>
        this.receivePack.pkt(
          `${command.oldId} ${command.newId} ${command.ref}${index === 0 ? `\0${caps.join(" ")}` : ""}\n`,
        ),
      ),
      this.receivePack.flush(),
      ...(commands.some((command) => command.newId !== GitReceivePack.ZERO)
        ? [ArtifactsGitBackend.EMPTY_PACK]
        : []),
    ] as BlobPart[]);
    const response = await this.proxy(ref, {
      service: "git-receive-pack",
      advertise: false,
      body: body.stream(),
      userAgent: "git/lore",
    });
    if (response.status !== 200 || typeof response.body === "string") {
      throw new AlephaError(`The ref update answered ${response.status}`);
    }
    const bytes = new Uint8Array(
      await new Response(response.body).arrayBuffer(),
    );
    return this.receivePack.decodeReport(bytes, caps).lines;
  }

  /**
   * Whether `ancestor` is reachable from `tip`, through every parent: true,
   * false, or undefined when {@link ArtifactsGitBackend.MAX_COMMIT_READS}
   * ran out first.
   *
   * The first `log` page (1000 commits of the first-parent chain, parents
   * included) answers the usual push alone. Past it the walk goes newest
   * commit first, reading the commits the page did not hold, and drops any
   * dated more than {@link ArtifactsGitBackend.CLOCK_SLOP_S} before the
   * ancestor, which cannot lead to it unless a clock lied that much: such a
   * push is refused, the safe side.
   */
  protected async ancestry(
    ref: string,
    ancestor: string,
    tip: string,
    maxReads = ArtifactsGitBackend.MAX_COMMIT_READS,
  ): Promise<boolean | undefined> {
    const repo = await this.repo(ref);
    if (!repo?.readCommit) return undefined;
    try {
      const known = new Map<string, ArtifactsCommit>();
      for (const entry of (await repo.log?.({ ref: tip, limit: 1000 })) ?? []) {
        if (entry.hash === ancestor) return true;
        if (entry.parents) known.set(entry.hash, entry as ArtifactsCommit);
      }
      let reads = 0;
      const read = async (hash: string) => {
        const cached = known.get(hash);
        if (cached) return cached;
        reads += 1;
        const commit = await repo.readCommit!(hash);
        if (commit) known.set(hash, commit);
        return commit ?? undefined;
      };
      const base = await read(ancestor);
      if (!base) return undefined;
      const seconds = (at: number | undefined) =>
        at === undefined ? 0 : at > 1e11 ? Math.floor(at / 1000) : at;
      const floor =
        seconds(base.committedAt) - ArtifactsGitBackend.CLOCK_SLOP_S;
      const seen = new Set<string>([tip]);
      let queue: ArtifactsCommit[] = [];
      const first = await read(tip);
      if (first) queue.push(first);
      while (queue.length) {
        if (reads > maxReads) return undefined;
        queue.sort((a, b) => seconds(b.committedAt) - seconds(a.committedAt));
        const batch = queue.slice(0, 25);
        queue = queue.slice(25);
        const parents = batch
          .flatMap((commit) => commit.parents ?? [])
          .filter((hash) => !seen.has(hash));
        if (parents.includes(ancestor)) return true;
        for (const hash of parents) seen.add(hash);
        const commits = await Promise.all(parents.map(read));
        for (const commit of commits) {
          if (commit && seconds(commit.committedAt) >= floor) {
            queue.push(commit);
          }
        }
      }
      return false;
    } finally {
      repo[Symbol.dispose]?.();
    }
  }

  /**
   * A full sha is read back (`readCommit`), so a sha the repository does
   * not hold resolves to nothing; a name is looked up in the advertisement
   * in {@link GitBackend.refCandidates}'s order, an annotated tag
   * peeled.
   */
  public async resolve(
    ref: string,
    revision: string,
  ): Promise<string | undefined> {
    if (GitBackend.isSha(revision)) {
      return (await this.commit(ref, revision))?.sha;
    }
    const candidates = GitBackend.refCandidates(revision);
    if (candidates.length === 0) return undefined;
    const tips = await this.refs(ref);
    for (const candidate of candidates) {
      const tip = tips.find((it) => it.name === candidate);
      if (tip) return tip.targetSha ?? tip.sha;
    }
    return undefined;
  }

  /**
   * The commit's root tree, then one `readTree` per path segment.
   */
  public async tree(
    ref: string,
    commit: string,
    path: string,
  ): Promise<GitTreeEntry[] | undefined> {
    const clean = GitBackend.cleanPath(path);
    if (!GitBackend.isSha(commit) || clean === undefined) return undefined;
    return this.withRepo(ref, async (repo) => {
      const root = await this.readCommitOf(repo, commit);
      if (!root?.treeHash) return undefined;
      let entries = await this.readTreeOf(repo, root.treeHash);
      for (const segment of clean ? clean.split("/") : []) {
        const next = entries?.find(
          (entry) => entry.name === segment && entry.type === "tree",
        );
        if (!next) return undefined;
        entries = await this.readTreeOf(repo, next.sha);
      }
      return entries;
    });
  }

  public async blob(
    ref: string,
    sha: string,
    options: GitReadOptions = {},
  ): Promise<GitBlobResult> {
    if (!GitBackend.isSha(sha)) return { kind: "not_found" };
    return (
      (await this.withRepo(ref, (repo) =>
        this.readSized(() => repo.readBlob?.(sha), options),
      )) ?? { kind: "not_found" }
    );
  }

  /**
   * By path in the commit's tree, then by blob sha: `readFile` would
   * answer a symlink's target and no tree entry, where git answers the
   * link itself.
   */
  public async file(
    ref: string,
    commit: string,
    path: string,
    options: GitReadOptions = {},
  ): Promise<GitBlobResult> {
    const clean = GitBackend.cleanPath(path);
    if (!clean) return { kind: "not_found" };
    const at = clean.lastIndexOf("/");
    const entries = await this.tree(
      ref,
      commit,
      at === -1 ? "" : clean.slice(0, at),
    );
    const entry = entries?.find(
      (it) => it.name === clean.slice(at + 1) && it.type === "blob",
    );
    if (!entry) return { kind: "not_found" };
    return this.blob(ref, entry.sha, options);
  }

  public async commit(
    ref: string,
    sha: string,
  ): Promise<GitCommitDetail | undefined> {
    if (!GitBackend.isSha(sha)) return undefined;
    const read = await this.withRepo(ref, (repo) =>
      this.readCommitOf(repo, sha),
    );
    if (!read) return undefined;
    return {
      sha: read.hash,
      parents: read.parents ?? [],
      treeSha: read.treeHash ?? "",
      author: {
        name: read.author?.name ?? "",
        email: read.author?.email ?? "",
        at: this.seconds(read.authoredAt ?? read.committedAt),
      },
      committer: {
        name: read.committer?.name ?? read.author?.name ?? "",
        email: read.committer?.email ?? read.author?.email ?? "",
        at: this.seconds(read.committedAt),
      },
      ...GitBackend.splitMessage(read.message ?? ""),
    };
  }

  public async mergeBase(
    ref: string,
    a: string,
    b: string,
    options: { maxReads?: number } = {},
  ): Promise<{ kind: "ok"; sha: string | undefined } | { kind: "cap" }> {
    if (!GitBackend.isSha(a) || !GitBackend.isSha(b)) {
      return { kind: "ok", sha: undefined };
    }
    const answer = await this.withRepo(ref, (repo) =>
      GitBackend.paintMergeBase(
        async (sha) => {
          const commit = await this.readCommitOf(repo, sha);
          return commit
            ? {
                parents: commit.parents ?? [],
                committedAt: this.seconds(commit.committedAt),
              }
            : undefined;
        },
        a,
        b,
        options.maxReads ?? ArtifactsGitBackend.MAX_COMMIT_READS,
      ),
    );
    return answer ?? { kind: "ok", sha: undefined };
  }

  public async isAncestor(
    ref: string,
    ancestor: string,
    tip: string,
    options: { maxReads?: number } = {},
  ): Promise<{ kind: "ok"; value: boolean } | { kind: "cap" }> {
    if (!GitBackend.isSha(ancestor) || !GitBackend.isSha(tip)) {
      return { kind: "ok", value: false };
    }
    if (ancestor === tip) {
      return { kind: "ok", value: Boolean(await this.commit(ref, tip)) };
    }
    const value = await this.ancestry(ref, ancestor, tip, options.maxReads);
    return value === undefined ? { kind: "cap" } : { kind: "ok", value };
  }

  /**
   * Run `fn` on the repository's handle, disposed after; undefined when
   * the namespace holds no repository by that ref.
   */
  protected async withRepo<T>(
    ref: string,
    fn: (repo: ArtifactsRepoHandle) => Promise<T>,
  ): Promise<T | undefined> {
    const repo = await this.repo(ref);
    if (!repo) return undefined;
    try {
      return await fn(repo);
    } finally {
      repo[Symbol.dispose]?.();
    }
  }

  protected async readCommitOf(
    repo: ArtifactsRepoHandle,
    sha: string,
  ): Promise<ArtifactsCommit | undefined> {
    if (!repo.readCommit) {
      throw new AlephaError("The Artifacts binding cannot read a commit");
    }
    try {
      return (await repo.readCommit(sha)) ?? undefined;
    } catch (error) {
      // A malformed or unknown hash reads as none, as on disk.
      if (["INVALID_INPUT", "NOT_FOUND"].includes(this.codeOf(error) ?? "")) {
        return undefined;
      }
      throw error;
    }
  }

  protected async readTreeOf(
    repo: ArtifactsRepoHandle,
    sha: string,
  ): Promise<GitTreeEntry[] | undefined> {
    if (!repo.readTree) {
      throw new AlephaError("The Artifacts binding cannot read a tree");
    }
    const entries = await repo.readTree(sha);
    if (!entries) return undefined;
    return entries.map((entry) => ({
      name: entry.name,
      // Artifacts writes a tree's mode as git does (`40000`).
      mode: entry.mode,
      type:
        entry.type === "tree"
          ? "tree"
          : entry.type === "gitlink"
            ? "commit"
            : "blob",
      sha: entry.hash,
    }));
  }

  /**
   * A `Blob` the binding answered, its size read before its bytes:
   * `Blob.size` is known before `arrayBuffer()` brings anything in. A
   * blob Artifacts itself refuses to read (`MEMORY_LIMIT`, over 32 MiB)
   * is too large too.
   */
  protected async readSized(
    read: () => Promise<Blob | null> | undefined,
    options: GitReadOptions,
  ): Promise<GitBlobResult> {
    let blob: Blob | null | undefined;
    try {
      blob = await read();
    } catch (error) {
      const code = this.codeOf(error);
      if (code === "MEMORY_LIMIT") {
        return {
          kind: "too_large",
          size: ArtifactsGitBackend.MEMORY_LIMIT_BYTES,
        };
      }
      if (code === "INVALID_INPUT" || code === "NOT_FOUND") {
        return { kind: "not_found" };
      }
      throw error;
    }
    if (!blob) return { kind: "not_found" };
    return GitBackend.sized(
      blob.size,
      options.maxBytes,
      async () => new Uint8Array(await blob.arrayBuffer()),
    );
  }

  /**
   * The largest blob Artifacts reads: a bigger one throws `MEMORY_LIMIT`.
   */
  public static readonly MEMORY_LIMIT_BYTES = 32 * 1024 * 1024;

  protected seconds(at: number | undefined): number {
    return at === undefined ? 0 : at > 1e11 ? Math.floor(at / 1000) : at;
  }

  /**
   * Proxy the request to the repository's Artifacts remote with a cached
   * repo-scoped token, streaming both bodies: the Worker holds no pack in
   * memory and spends 0 to 4 ms of CPU per request (folio #F1527).
   */
  protected async proxy(
    ref: string,
    rpc: GitRpcRequest,
  ): Promise<GitRpcResponse> {
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
  }): Promise<Array<{ hash: string; message: string; parents?: string[] }>>;
  /**
   * One commit, its parents included; null when the repository holds none
   * by that id.
   */
  readCommit?(hash: string): Promise<ArtifactsCommit | null>;
  /**
   * A tree's immediate children; null when there is no tree by that id.
   */
  readTree?(hash: string): Promise<ArtifactsTreeEntry[] | null>;
  /**
   * A blob's bytes, untyped; null when there is no blob by that id.
   * Throws `MEMORY_LIMIT` past 32 MiB.
   */
  readBlob?(hash: string): Promise<Blob | null>;
  [Symbol.dispose]?: () => void;
}

/**
 * A commit as the binding answers it (`log`, `readCommit`): the fields Lore
 * reads. `committedAt` is in seconds, as Artifacts answered on 2026-11-22;
 * milliseconds are told apart by size.
 */
export interface ArtifactsCommit {
  hash: string;
  message: string;
  parents: string[];
  committedAt?: number;
  treeHash?: string;
  author?: { name: string; email: string };
  committer?: { name: string; email: string };
  authoredAt?: number;
}

/**
 * A tree entry as the binding answers it (`readTree`).
 */
export interface ArtifactsTreeEntry {
  name: string;
  /**
   * git's mode: `100644`, `40000`, ...
   */
  mode: string;
  hash: string;
  type: "tree" | "blob" | "symlink" | "gitlink" | "exec";
}
